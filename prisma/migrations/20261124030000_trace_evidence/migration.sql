-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE traceability.trace_evidence (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  event_id uuid NOT NULL REFERENCES traceability.trace_event(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES trading.document(id) ON DELETE RESTRICT,
  attachment_id uuid NOT NULL REFERENCES platform.attachment(id) ON DELETE RESTRICT,
  checksum_hex char(64) NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  state text NOT NULL DEFAULT 'active',
  created_by_sub text NOT NULL,
  revoked_at timestamptz(6),
  CONSTRAINT uq_trace_evidence_event_file UNIQUE (event_id, attachment_id),
  CONSTRAINT ck_trace_evidence_checksum CHECK (checksum_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_trace_evidence_visibility CHECK (visibility IN ('private','partner','public')),
  CONSTRAINT ck_trace_evidence_state CHECK (state IN ('active','revoked')),
  CONSTRAINT ck_trace_evidence_revoked CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX idx_trace_evidence_document_state ON traceability.trace_evidence(document_id,state);

CREATE FUNCTION traceability.guard_trace_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM traceability.trace_event e
    JOIN trading.document d ON d.id = e.document_id AND d.status = 'confirmed'
    JOIN platform.attachment a ON a.id = NEW.attachment_id
    WHERE e.id = NEW.event_id AND e.document_id = NEW.document_id
      AND e.verification_state = 'local_verified'
      AND a.scan_state = 'clean' AND a.bucket = 'private'
      AND a.visibility = 'private' AND a.owner_type = 'core_record'
      AND a.owner_id IS NULL AND a.sha256_hex = NEW.checksum_hex
  ) THEN RAISE EXCEPTION 'trace_evidence:source_or_file_invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trace_evidence_guard BEFORE INSERT ON traceability.trace_evidence
  FOR EACH ROW EXECUTE FUNCTION traceability.guard_trace_evidence();
CREATE FUNCTION traceability.guard_trace_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'active' OR NEW.state <> 'revoked' OR NEW.revoked_at IS NULL OR
      (NEW.id,NEW.event_id,NEW.document_id,NEW.attachment_id,NEW.checksum_hex,
       NEW.visibility,NEW.created_by_sub,NEW.created_at) IS DISTINCT FROM
      (OLD.id,OLD.event_id,OLD.document_id,OLD.attachment_id,OLD.checksum_hex,
       OLD.visibility,OLD.created_by_sub,OLD.created_at) THEN
    RAISE EXCEPTION 'trace_evidence:immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trace_evidence_update BEFORE UPDATE ON traceability.trace_evidence
  FOR EACH ROW EXECUTE FUNCTION traceability.guard_trace_evidence_update();

CREATE FUNCTION traceability.stale_passport_on_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE traceability.passport_projection p SET state = 'stale',
    version = p.version + 1, updated_at = now()
    FROM traceability.trace_event e
    WHERE e.id = NEW.event_id AND p.batch_id = e.batch_id AND p.state = 'active';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_evidence_stale_passport AFTER INSERT OR UPDATE OF state
  ON traceability.trace_evidence FOR EACH ROW
  EXECUTE FUNCTION traceability.stale_passport_on_evidence();
CREATE FUNCTION traceability.stale_passport_on_attachment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE traceability.passport_projection p SET state = 'stale',
    version = p.version + 1, updated_at = now()
    FROM traceability.trace_evidence evidence
    JOIN traceability.trace_event event ON event.id = evidence.event_id
    WHERE evidence.attachment_id = NEW.id AND p.batch_id = event.batch_id
      AND p.state = 'active';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_attachment_trace_stale AFTER UPDATE OF scan_state,bucket,visibility,sha256_hex
  ON platform.attachment FOR EACH ROW
  WHEN (OLD.scan_state IS DISTINCT FROM NEW.scan_state OR OLD.bucket IS DISTINCT FROM NEW.bucket
    OR OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.sha256_hex IS DISTINCT FROM NEW.sha256_hex)
  EXECUTE FUNCTION traceability.stale_passport_on_attachment();

CREATE TABLE traceability.trace_evidence_access (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  token_hash char(64) NOT NULL UNIQUE,
  qr_token_id uuid NOT NULL REFERENCES traceability.qr_token(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES traceability.trace_evidence(id) ON DELETE RESTRICT,
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT ck_trace_evidence_access_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_trace_evidence_access_ttl CHECK (expires_at > created_at AND
    expires_at <= created_at + interval '120 seconds')
);
CREATE INDEX idx_trace_evidence_access_expiry ON traceability.trace_evidence_access(expires_at);

-- Core Data receives only a narrow, filtered read view. It never sees raw QR tokens.
CREATE VIEW traceability.public_evidence_download WITH (security_barrier=true) AS
SELECT access.token_hash, access.expires_at, a.id AS attachment_id, a.object_key,
  a.sha256_hex, a.mime_type, a.size_bytes
FROM traceability.trace_evidence_access access
JOIN traceability.trace_evidence evidence ON evidence.id = access.evidence_id
JOIN traceability.trace_event event ON event.id = evidence.event_id
JOIN trading.document document ON document.id = evidence.document_id
JOIN platform.attachment a ON a.id = evidence.attachment_id
JOIN traceability.qr_token qr ON qr.id = access.qr_token_id
JOIN traceability.passport_projection projection ON projection.batch_id = qr.batch_id
JOIN traceability.passport_policy policy ON policy.batch_id = qr.batch_id
  AND ('v' || policy.policy_version::text) = qr.policy_version
JOIN catalog.batch batch ON batch.id = qr.batch_id
WHERE access.created_at <= now() AND access.expires_at > now()
  AND qr.state = 'active' AND qr.expires_at > now()
  AND qr.policy_version = projection.policy_version AND projection.state = 'active'
  AND policy.state = 'approved' AND policy.evidence_visibility = 'public'
  AND policy.timeline_visibility = 'public' AND batch.quality_status = 'available'
  AND event.batch_id = qr.batch_id AND event.document_id = evidence.document_id
  AND event.verification_state = 'local_verified' AND document.status = 'confirmed'
  AND evidence.visibility = 'public' AND evidence.state = 'active'
  AND a.scan_state = 'clean' AND a.bucket = 'private' AND a.visibility = 'private'
  AND a.sha256_hex = evidence.checksum_hex;

GRANT SELECT, INSERT, UPDATE ON traceability.trace_evidence TO app_runtime;
GRANT SELECT, INSERT, DELETE ON traceability.trace_evidence_access TO app_runtime;
GRANT USAGE ON SCHEMA traceability TO core_data;
GRANT SELECT ON traceability.public_evidence_download TO core_data;
COMMIT;

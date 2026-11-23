-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE traceability.passport_policy (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL REFERENCES catalog.batch(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  organization_visibility text NOT NULL DEFAULT 'private',
  product_visibility text NOT NULL DEFAULT 'private',
  batch_visibility text NOT NULL DEFAULT 'private',
  timeline_visibility text NOT NULL DEFAULT 'private',
  evidence_visibility text NOT NULL DEFAULT 'private',
  created_by_sub text NOT NULL,
  approved_by_sub text,
  approved_at timestamptz(6),
  revoked_by_sub text,
  revoked_at timestamptz(6),
  CONSTRAINT uq_passport_policy_version UNIQUE (batch_id,policy_version),
  CONSTRAINT ck_passport_policy_version CHECK (policy_version > 0),
  CONSTRAINT ck_passport_policy_state CHECK (state IN ('draft','approved','revoked')),
  CONSTRAINT ck_passport_policy_visibility CHECK (
    organization_visibility IN ('private','partner','public') AND
    product_visibility IN ('private','partner','public') AND
    batch_visibility IN ('private','partner','public') AND
    timeline_visibility IN ('private','partner','public') AND
    evidence_visibility IN ('private','partner','public')),
  CONSTRAINT ck_passport_policy_approval CHECK (
    (state = 'draft' AND approved_at IS NULL AND approved_by_sub IS NULL AND
      revoked_at IS NULL AND revoked_by_sub IS NULL) OR
    (state = 'approved' AND approved_at IS NOT NULL AND approved_by_sub IS NOT NULL AND
      revoked_at IS NULL AND revoked_by_sub IS NULL) OR
    (state = 'revoked' AND approved_at IS NOT NULL AND approved_by_sub IS NOT NULL AND
      revoked_at IS NOT NULL AND revoked_by_sub IS NOT NULL))
);
CREATE INDEX idx_passport_policy_state ON traceability.passport_policy(batch_id,state);
CREATE UNIQUE INDEX uq_passport_policy_draft ON traceability.passport_policy(batch_id)
  WHERE state = 'draft';
CREATE UNIQUE INDEX uq_passport_policy_approved ON traceability.passport_policy(batch_id)
  WHERE state = 'approved';

-- Any new provenance makes a previously published projection stale until rebuilt.
CREATE FUNCTION traceability.stale_passport_on_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE traceability.passport_projection SET state = 'stale', version = version + 1,
    updated_at = now() WHERE batch_id = NEW.batch_id AND state = 'active';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_passport_stale_on_event AFTER INSERT ON traceability.trace_event
  FOR EACH ROW EXECUTE FUNCTION traceability.stale_passport_on_event();

-- A confirmed business action is pending trace projection as soon as its outbox row exists.
CREATE FUNCTION traceability.stale_passport_on_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.destination = 'traceability' THEN
    UPDATE traceability.passport_projection SET state = 'stale', version = version + 1,
      updated_at = now() WHERE state = 'active' AND batch_id IN (
        SELECT DISTINCT l.batch_id FROM trading.document_line l
        WHERE l.document_id = NEW.aggregate_id AND l.batch_id IS NOT NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_passport_stale_on_outbox AFTER INSERT ON platform.outbox_message
  FOR EACH ROW EXECUTE FUNCTION traceability.stale_passport_on_outbox();

-- A changed quality decision requires a fresh owner-approved publication.
CREATE FUNCTION traceability.revoke_passport_on_quality() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE traceability.passport_projection SET state = 'revoked', version = version + 1,
    updated_at = now() WHERE batch_id = NEW.id AND state <> 'revoked';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_passport_revoke_on_quality AFTER UPDATE OF quality_status ON catalog.batch
  FOR EACH ROW WHEN (OLD.quality_status IS DISTINCT FROM NEW.quality_status)
  EXECUTE FUNCTION traceability.revoke_passport_on_quality();

GRANT SELECT, INSERT, UPDATE ON traceability.passport_policy TO app_runtime;
COMMIT;

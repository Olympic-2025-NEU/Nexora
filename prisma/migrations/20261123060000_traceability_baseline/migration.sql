-- SPDX-License-Identifier: AGPL-3.0-only
-- P08-T01: append-only local provenance; P09 adds the federation inbox FK.
BEGIN;
CREATE SCHEMA traceability;

CREATE TABLE traceability.trace_event (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  issuer_instance_id text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  batch_id uuid REFERENCES catalog.batch(id) ON DELETE RESTRICT,
  document_id uuid REFERENCES trading.document(id) ON DELETE RESTRICT,
  source_message_id uuid,
  origin_issuer_instance_id text NOT NULL,
  origin_lot_id text NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  verification_state text NOT NULL,
  payload_version text NOT NULL,
  summary jsonb NOT NULL,
  evidence_refs uuid[] NOT NULL DEFAULT '{}',
  checksum_hex char(64) NOT NULL,
  CONSTRAINT ck_trace_event_issuer CHECK (length(trim(issuer_instance_id)) BETWEEN 1 AND 128),
  CONSTRAINT ck_trace_event_external CHECK (length(trim(external_event_id)) BETWEEN 1 AND 128),
  CONSTRAINT ck_trace_event_type CHECK (length(trim(event_type)) BETWEEN 1 AND 128),
  CONSTRAINT ck_trace_event_origin CHECK (length(trim(origin_issuer_instance_id)) BETWEEN 1 AND 128
    AND length(trim(origin_lot_id)) BETWEEN 1 AND 128),
  CONSTRAINT ck_trace_event_version CHECK (length(trim(payload_version)) BETWEEN 1 AND 32),
  CONSTRAINT ck_trace_event_verification CHECK (verification_state IN ('local_verified','partner_asserted','missing')),
  CONSTRAINT ck_trace_event_local_source CHECK (verification_state <> 'local_verified' OR
    (batch_id IS NOT NULL AND document_id IS NOT NULL AND source_message_id IS NULL)),
  CONSTRAINT ck_trace_event_summary CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT ck_trace_event_checksum CHECK (checksum_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_trace_event_external UNIQUE (issuer_instance_id, external_event_id)
);
CREATE UNIQUE INDEX uq_trace_event_local_action ON traceability.trace_event(document_id,batch_id,event_type)
  WHERE verification_state = 'local_verified';
CREATE INDEX idx_trace_event_batch_time ON traceability.trace_event(batch_id,occurred_at);
CREATE INDEX idx_trace_event_origin_time ON traceability.trace_event(origin_issuer_instance_id,origin_lot_id,occurred_at);
CREATE INDEX idx_trace_event_document ON traceability.trace_event(document_id);

CREATE FUNCTION traceability.guard_trace_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trading.document d
    JOIN trading.document_line l ON l.document_id = d.id AND l.batch_id = NEW.batch_id
    JOIN catalog.batch b ON b.id = l.batch_id AND b.origin_issuer_instance_id = NEW.origin_issuer_instance_id
      AND b.origin_lot_id = NEW.origin_lot_id
    WHERE d.id = NEW.document_id AND d.status = 'confirmed' AND (
      (d.document_type = 'goods_receipt' AND NEW.event_type = 'trading.receipt.confirmed.v1') OR
      (d.document_type = 'goods_issue' AND NEW.event_type = 'trading.issue.confirmed.v1') OR
      (d.document_type = 'partner_transfer' AND NEW.event_type = 'trading.transfer.confirmed.v1') OR
      (d.document_type = 'receiving_confirmation' AND NEW.event_type = 'trading.receiving.confirmed.v1') OR
      (d.document_type = 'stocktake' AND NEW.event_type = 'trading.stocktake.confirmed.v1') OR
      (d.document_type = 'sale_record' AND NEW.event_type = 'trading.sale.recorded.v1')
    )) THEN
    RAISE EXCEPTION 'trace_event:source_not_confirmed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trace_event_local_source BEFORE INSERT ON traceability.trace_event
  FOR EACH ROW WHEN (NEW.verification_state = 'local_verified')
  EXECUTE FUNCTION traceability.guard_trace_event();
CREATE FUNCTION traceability.reject_trace_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trace_event:immutable';
END $$;
CREATE TRIGGER trg_trace_event_immutable BEFORE UPDATE OR DELETE ON traceability.trace_event
  FOR EACH ROW EXECUTE FUNCTION traceability.reject_trace_mutation();

CREATE TABLE traceability.trace_link (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  from_event_id uuid NOT NULL REFERENCES traceability.trace_event(id) ON DELETE RESTRICT,
  to_event_id uuid REFERENCES traceability.trace_event(id) ON DELETE RESTRICT,
  missing_ref jsonb,
  relation text NOT NULL,
  verification_state text NOT NULL,
  CONSTRAINT ck_trace_link_target CHECK ((to_event_id IS NOT NULL) <> (missing_ref IS NOT NULL)),
  CONSTRAINT ck_trace_link_self CHECK (to_event_id IS NULL OR from_event_id <> to_event_id),
  CONSTRAINT ck_trace_link_relation CHECK (relation IN ('derived_from','transferred_to','received_from','sold_as','corrects')),
  CONSTRAINT ck_trace_link_verification CHECK (verification_state IN ('local_verified','partner_asserted','missing')),
  CONSTRAINT ck_trace_link_missing_state CHECK ((to_event_id IS NULL) = (verification_state = 'missing')),
  CONSTRAINT ck_trace_link_missing_shape CHECK (missing_ref IS NULL OR (
    jsonb_typeof(missing_ref) = 'object' AND
    jsonb_typeof(missing_ref->'issuerInstanceId') = 'string' AND
    jsonb_typeof(missing_ref->'eventId') = 'string' AND
    length(trim(missing_ref->>'issuerInstanceId')) BETWEEN 1 AND 128 AND
    length(trim(missing_ref->>'eventId')) BETWEEN 1 AND 128 AND
    missing_ref = jsonb_build_object('issuerInstanceId',missing_ref->>'issuerInstanceId',
      'eventId',missing_ref->>'eventId')
  ))
);
CREATE UNIQUE INDEX uq_trace_link_event ON traceability.trace_link(from_event_id,to_event_id,relation)
  WHERE to_event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_trace_link_gap ON traceability.trace_link(from_event_id,relation,missing_ref)
  WHERE to_event_id IS NULL;
CREATE INDEX idx_trace_link_to_event ON traceability.trace_link(to_event_id);

CREATE TABLE traceability.passport_projection (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  batch_id uuid NOT NULL REFERENCES catalog.batch(id) ON DELETE RESTRICT,
  public_payload jsonb NOT NULL,
  source_event_ids uuid[] NOT NULL DEFAULT '{}',
  policy_version text NOT NULL,
  built_at timestamptz(6) NOT NULL,
  state text NOT NULL DEFAULT 'stale',
  checksum_hex char(64) NOT NULL,
  CONSTRAINT uq_passport_batch UNIQUE (batch_id),
  CONSTRAINT ck_passport_version CHECK (version > 0),
  CONSTRAINT ck_passport_payload CHECK (jsonb_typeof(public_payload) = 'object'),
  CONSTRAINT ck_passport_policy CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
  CONSTRAINT ck_passport_state CHECK (state IN ('active','revoked','stale')),
  CONSTRAINT ck_passport_checksum CHECK (checksum_hex ~ '^[0-9a-f]{64}$')
);
CREATE INDEX idx_passport_state_built ON traceability.passport_projection(state,built_at);

CREATE TABLE traceability.qr_token (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL REFERENCES catalog.batch(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL,
  state text NOT NULL DEFAULT 'revoked',
  expires_at timestamptz(6),
  revoked_at timestamptz(6),
  created_by_sub text NOT NULL,
  CONSTRAINT uq_qr_token_hash UNIQUE (token_hash),
  CONSTRAINT ck_qr_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_qr_token_state CHECK (state IN ('active','revoked')),
  CONSTRAINT ck_qr_token_revoked CHECK (revoked_at IS NULL OR state = 'revoked'),
  CONSTRAINT ck_qr_token_actor CHECK (length(trim(created_by_sub)) BETWEEN 1 AND 256)
);
CREATE INDEX idx_qr_batch_state ON traceability.qr_token(batch_id,state);

GRANT USAGE ON SCHEMA traceability TO app_runtime;
GRANT SELECT, INSERT ON traceability.trace_event, traceability.trace_link TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON traceability.passport_projection, traceability.qr_token TO app_runtime;
COMMIT;

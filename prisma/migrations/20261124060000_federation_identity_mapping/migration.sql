-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE federation.identity_mapping (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  origin_issuer_instance_id text NOT NULL,
  origin_lot_id text NOT NULL,
  sender_instance_id text NOT NULL,
  sender_batch_id text NOT NULL,
  local_batch_id uuid NOT NULL REFERENCES catalog.batch(id) ON DELETE RESTRICT,
  source_message_id uuid NOT NULL REFERENCES federation.inbox_message(id) ON DELETE RESTRICT,
  verification_state text NOT NULL DEFAULT 'partner_asserted'
    CHECK (verification_state IN ('partner_asserted','verified')),
  CONSTRAINT uq_identity_sender_origin UNIQUE
    (sender_instance_id,sender_batch_id,origin_issuer_instance_id,origin_lot_id),
  CONSTRAINT ck_identity_ref_nonempty CHECK (length(trim(origin_issuer_instance_id)) > 0 AND
    length(trim(origin_lot_id)) > 0 AND length(trim(sender_instance_id)) > 0 AND
    length(trim(sender_batch_id)) > 0)
);
CREATE INDEX idx_identity_local_batch ON federation.identity_mapping(local_batch_id);
ALTER TABLE traceability.trace_event ADD CONSTRAINT fk_trace_event_inbox
  FOREIGN KEY (source_message_id) REFERENCES federation.inbox_message(id) ON DELETE RESTRICT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON federation.identity_mapping TO app_runtime;
    GRANT UPDATE ON traceability.trace_link TO app_runtime;
  END IF;
END $$;
COMMIT;

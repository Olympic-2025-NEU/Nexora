-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE federation.inbox_message (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  issuer_instance_id text NOT NULL,
  message_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  schema_version text NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  partner_id uuid NOT NULL REFERENCES system.partner(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'validated' CHECK (state IN ('validated','pending_dependency','applied_to_trace','rejected')),
  received_at timestamptz(6) NOT NULL DEFAULT now(),
  applied_at timestamptz(6),
  error_code text,
  CONSTRAINT uq_inbox_issuer_message UNIQUE (issuer_instance_id,message_id),
  CONSTRAINT uq_inbox_issuer_event_type UNIQUE (issuer_instance_id,event_id,event_type)
);
CREATE INDEX idx_inbox_state_received ON federation.inbox_message(state,received_at);
CREATE INDEX idx_inbox_event ON federation.inbox_message(event_id);
CREATE TABLE federation.partner_ack (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  inbox_id uuid NOT NULL UNIQUE REFERENCES federation.inbox_message(id) ON DELETE RESTRICT,
  ack_id text NOT NULL UNIQUE,
  ack_status text NOT NULL CHECK (ack_status IN ('validated','pending_dependency')),
  response_body jsonb NOT NULL,
  sent_at timestamptz(6)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON federation.inbox_message, federation.partner_ack TO app_runtime;
  END IF;
END $$;
COMMIT;

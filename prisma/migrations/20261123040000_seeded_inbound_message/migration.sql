-- SPDX-License-Identifier: AGPL-3.0-only
CREATE TABLE platform.inbound_message (
  message_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  issuer_instance_id text NOT NULL,
  recipient_instance_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL CONSTRAINT ck_inbound_payload_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX idx_inbound_message_received ON platform.inbound_message(received_at DESC);
GRANT SELECT, INSERT ON platform.inbound_message TO app_runtime;

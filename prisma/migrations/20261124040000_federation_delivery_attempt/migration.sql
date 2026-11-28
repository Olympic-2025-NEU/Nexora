-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE SCHEMA IF NOT EXISTS federation;
CREATE TABLE federation.delivery_attempt (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  outbox_id uuid NOT NULL REFERENCES platform.outbox_message(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CONSTRAINT ck_delivery_attempt_no CHECK (attempt_no > 0),
  endpoint_host text NOT NULL CONSTRAINT ck_delivery_endpoint_host CHECK (length(trim(endpoint_host)) BETWEEN 1 AND 253),
  http_status smallint CONSTRAINT ck_delivery_http_status CHECK (http_status BETWEEN 100 AND 599),
  result text NOT NULL CONSTRAINT ck_delivery_result CHECK (result IN ('ack','retry','permanent_failure')),
  error_code text,
  duration_ms integer CONSTRAINT ck_delivery_duration CHECK (duration_ms >= 0),
  ack_message_id text,
  ack_id text,
  ack_status text CONSTRAINT ck_delivery_ack_status CHECK (ack_status IN ('validated','pending_dependency')),
  CONSTRAINT uq_delivery_outbox_attempt UNIQUE (outbox_id,attempt_no),
  CONSTRAINT ck_delivery_ack_fields CHECK (
    (result = 'ack' AND http_status = 202 AND ack_message_id IS NOT NULL AND
      ack_id IS NOT NULL AND ack_status IS NOT NULL AND error_code IS NULL) OR
    (result <> 'ack' AND ack_message_id IS NULL AND ack_id IS NULL AND ack_status IS NULL AND error_code IS NOT NULL)
  )
);
CREATE INDEX idx_delivery_outbox_created ON federation.delivery_attempt(outbox_id,created_at DESC);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA federation TO app_runtime;
    GRANT SELECT, INSERT ON federation.delivery_attempt TO app_runtime;
  END IF;
END $$;
COMMIT;

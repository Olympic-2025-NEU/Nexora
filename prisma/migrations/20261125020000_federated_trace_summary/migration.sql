-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE federation.federated_trace_summary (
  id uuid PRIMARY KEY,
  issuer_instance_id text NOT NULL,
  external_event_id text NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  disclosure_scope text NOT NULL CHECK (disclosure_scope IN ('partner', 'public')),
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  source_inbox_id uuid NOT NULL REFERENCES federation.inbox_message(id),
  observed_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL REFERENCES catalog.batch(id),
  CONSTRAINT uq_federated_trace_source UNIQUE (issuer_instance_id, external_event_id)
);
CREATE INDEX idx_federated_trace_batch_state
  ON federation.federated_trace_summary (batch_id, state);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON federation.federated_trace_summary TO app_runtime;
  END IF;
END $$;
COMMIT;

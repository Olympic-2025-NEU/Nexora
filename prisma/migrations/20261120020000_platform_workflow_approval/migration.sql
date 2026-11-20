-- SPDX-License-Identifier: AGPL-3.0-only
CREATE TYPE platform.approval_request_state AS ENUM
  ('requested','starting','pending','decision_pending','approved','rejected','confirmed','cancelled','halted');
CREATE TABLE platform.approval_request (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL UNIQUE,
  submitted_document_version integer NOT NULL,
  creator_sub text NOT NULL,
  warehouse_ids jsonb NOT NULL,
  line_snapshot_sha256 char(64) NOT NULL,
  state platform.approval_request_state NOT NULL DEFAULT 'requested',
  flowable_process_id text,
  flowable_definition_id text,
  flowable_definition_version integer,
  flowable_task_id text,
  decision_intent text CHECK (decision_intent IN ('approved','rejected')),
  decision_intent_reason text,
  decision_requested_by_sub text,
  decision_requested_at timestamptz,
  decision text CHECK (decision IN ('approved','rejected')),
  decision_reason text,
  approver_sub text,
  decided_at timestamptz,
  engine_completed_at timestamptz,
  cancel_reason text,
  engine_cleanup_at timestamptz,
  halt_reason text,
  confirmed_by_sub text,
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_request_process_uq ON platform.approval_request (flowable_process_id) WHERE flowable_process_id IS NOT NULL;
CREATE INDEX approval_request_reconcile_ix ON platform.approval_request (state, updated_at);
GRANT USAGE ON TYPE platform.approval_request_state TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON platform.approval_request TO app_runtime;

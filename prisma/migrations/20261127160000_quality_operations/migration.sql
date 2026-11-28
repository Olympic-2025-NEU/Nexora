-- SPDX-License-Identifier: AGPL-3.0-only
-- P12-T04: operational quality_issue table (legend 0009_quality_operations).
BEGIN;

CREATE TABLE traceability.quality_issue (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  rule_id text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  severity text NOT NULL,
  source_event_ids uuid[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL,
  policy_version text NOT NULL,
  first_detected_at timestamptz(6) NOT NULL,
  last_detected_at timestamptz(6) NOT NULL,
  resolved_at timestamptz(6),
  resolved_by_sub text,
  CONSTRAINT ck_quality_issue_rule CHECK (rule_id IN (
    'missing_source','out_of_order','conflicting_quantity','unscanned_evidence','unknown_issuer','stale_partner_summary')),
  CONSTRAINT ck_quality_issue_source_type CHECK (source_type IN ('lot','event','attachment','partner')),
  CONSTRAINT ck_quality_issue_source_id CHECK (char_length(source_id) BETWEEN 1 AND 256),
  CONSTRAINT ck_quality_issue_state CHECK (state IN ('open','acknowledged','resolved')),
  CONSTRAINT ck_quality_issue_severity CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT ck_quality_issue_detail CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT ck_quality_issue_version CHECK (version >= 1),
  CONSTRAINT uq_quality_issue_rule_source UNIQUE (rule_id, source_type, source_id)
);

CREATE INDEX idx_quality_issue_state ON traceability.quality_issue(state, severity, last_detected_at DESC);
CREATE INDEX idx_quality_issue_source ON traceability.quality_issue(source_type, source_id);

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON traceability.quality_issue TO app_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;

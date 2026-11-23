-- SPDX-License-Identifier: AGPL-3.0-only
-- Reference consumer state in disposable test database only.
CREATE TABLE platform.event_test_effect (
  event_id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  UNIQUE (document_id, document_version)
);
CREATE TABLE platform.event_test_projection (
  document_id uuid PRIMARY KEY,
  document_version integer NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON platform.event_test_effect, platform.event_test_projection TO app_runtime;

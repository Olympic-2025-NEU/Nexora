-- SPDX-License-Identifier: AGPL-3.0-only
-- Isolated P00-D03 spike schema; never apply to the Nexora application database.
CREATE TABLE p00_d03.document (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'issue'),
  quantity numeric(20,3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE p00_d03.balance (
  id integer PRIMARY KEY CHECK (id = 1),
  quantity numeric(20,3) NOT NULL CHECK (quantity >= 0)
);

CREATE TABLE p00_d03.movement (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES p00_d03.document(id),
  delta numeric(20,3) NOT NULL CHECK (delta < 0),
  balance_after numeric(20,3) NOT NULL CHECK (balance_after >= 0)
);

CREATE TABLE p00_d03.audit (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES p00_d03.document(id),
  action text NOT NULL CHECK (action = 'issue.confirmed')
);

CREATE TABLE p00_d03.outbox (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES p00_d03.document(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL
);

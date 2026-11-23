-- SPDX-License-Identifier: AGPL-3.0-only
-- P03-T02 scratch tables in a disposable DB. Production outbox/stock land in P04/P06.
CREATE TABLE platform.tx_spike_aggregate (
  id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'confirmed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE platform.tx_spike_stock (
  stock_key text PRIMARY KEY,
  quantity integer NOT NULL CHECK (quantity >= 0)
);
CREATE TABLE platform.tx_spike_movement (
  id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES platform.tx_spike_aggregate(id),
  stock_key text NOT NULL REFERENCES platform.tx_spike_stock(stock_key),
  delta integer NOT NULL CHECK (delta < 0),
  UNIQUE (aggregate_id, stock_key)
);
CREATE TABLE platform.tx_spike_outbox (
  id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES platform.tx_spike_aggregate(id),
  event_type text NOT NULL,
  UNIQUE (aggregate_id, event_type)
);
GRANT SELECT, INSERT, UPDATE ON
  platform.tx_spike_aggregate, platform.tx_spike_stock,
  platform.tx_spike_movement, platform.tx_spike_outbox TO app_runtime;

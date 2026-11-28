-- SPDX-License-Identifier: AGPL-3.0-only
-- ADR 0019: commercial sales order + invoice trace token
BEGIN;

CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE sales.sales_order (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'paid', 'fulfilled', 'cancelled')),
  seller_membership_id uuid REFERENCES system.membership(id) ON DELETE RESTRICT,
  customer_partner_id uuid REFERENCES system.partner(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL,
  subtotal_amount numeric(20,3) NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount numeric(20,3) NOT NULL CHECK (total_amount >= 0),
  paid_amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'card')),
  paid_at timestamptz(6),
  sold_at timestamptz(6) NOT NULL,
  linked_issue_id uuid REFERENCES trading.document(id) ON DELETE RESTRICT,
  linked_sale_id uuid REFERENCES trading.document(id) ON DELETE RESTRICT,
  active_trace_token_id uuid,
  created_by_sub text NOT NULL,
  correlation_id text NOT NULL,
  note text,
  CONSTRAINT uq_sales_order_number UNIQUE (order_number),
  CONSTRAINT ck_sales_order_number_len CHECK (length(trim(order_number)) BETWEEN 1 AND 40)
);

CREATE INDEX idx_sales_order_status_sold ON sales.sales_order(status, sold_at DESC);
CREATE INDEX idx_sales_order_seller ON sales.sales_order(seller_membership_id);
CREATE INDEX idx_sales_order_customer ON sales.sales_order(customer_partner_id);
CREATE INDEX idx_sales_order_linked_issue ON sales.sales_order(linked_issue_id);
CREATE INDEX idx_sales_order_linked_sale ON sales.sales_order(linked_sale_id);

CREATE TABLE sales.sales_order_line (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  order_id uuid NOT NULL REFERENCES sales.sales_order(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL REFERENCES catalog.product(id) ON DELETE RESTRICT,
  product_variant_id uuid NOT NULL REFERENCES catalog.product_variant(id) ON DELETE RESTRICT,
  uom_id uuid NOT NULL REFERENCES catalog.uom(id) ON DELETE RESTRICT,
  quantity numeric(20,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,3) NOT NULL CHECK (unit_price >= 0),
  price_type text NOT NULL CHECK (price_type IN ('retail', 'wholesale')),
  line_discount numeric(20,3) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total numeric(20,3) NOT NULL CHECK (line_total >= 0),
  price_list_item_id uuid REFERENCES catalog.price_list_item(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sales_order_line_no UNIQUE (order_id, line_no)
);

CREATE INDEX idx_sales_order_line_order ON sales.sales_order_line(order_id);
CREATE INDEX idx_sales_order_line_variant ON sales.sales_order_line(product_variant_id);

CREATE TABLE sales.sales_order_line_lot (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  order_line_id uuid NOT NULL REFERENCES sales.sales_order_line(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  warehouse_id uuid NOT NULL REFERENCES inventory.warehouse(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  product_variant_id uuid NOT NULL,
  quantity numeric(20,3) NOT NULL CHECK (quantity > 0),
  source_issue_line_id uuid REFERENCES trading.document_line(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sales_order_line_lot_no UNIQUE (order_line_id, line_no),
  CONSTRAINT fk_sales_line_lot_batch FOREIGN KEY (batch_id, product_variant_id)
    REFERENCES catalog.batch(id, product_variant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_sales_line_lot_line ON sales.sales_order_line_lot(order_line_id);
CREATE INDEX idx_sales_line_lot_batch ON sales.sales_order_line_lot(batch_id);
CREATE INDEX idx_sales_line_lot_warehouse ON sales.sales_order_line_lot(warehouse_id);

CREATE TABLE sales.order_trace_token (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  order_id uuid NOT NULL REFERENCES sales.sales_order(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  snapshot_json jsonb NOT NULL,
  qr_path text,
  revoked_at timestamptz(6),
  created_by_sub text NOT NULL,
  CONSTRAINT uq_sales_order_trace_token_hash UNIQUE (token_hash),
  CONSTRAINT ck_sales_order_trace_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_sales_order_active_trace_token
  ON sales.order_trace_token(order_id) WHERE status = 'active';
CREATE INDEX idx_sales_order_trace_token_order ON sales.order_trace_token(order_id);

ALTER TABLE sales.sales_order
  ADD CONSTRAINT fk_sales_order_active_trace_token
  FOREIGN KEY (active_trace_token_id) REFERENCES sales.order_trace_token(id) ON DELETE RESTRICT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA sales TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON sales.sales_order TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON sales.sales_order_line TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON sales.sales_order_line_lot TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON sales.order_trace_token TO app_runtime;
  END IF;
END $$;

COMMIT;

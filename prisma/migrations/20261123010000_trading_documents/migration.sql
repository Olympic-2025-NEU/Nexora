-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE SCHEMA IF NOT EXISTS trading;

CREATE TABLE trading.document (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CONSTRAINT ck_trading_document_version CHECK (version > 0),
  document_type text NOT NULL CONSTRAINT ck_trading_document_type CHECK (document_type IN ('goods_receipt','goods_issue','partner_transfer','receiving_confirmation','stocktake','sale_record')),
  issue_purpose text CONSTRAINT ck_trading_issue_purpose CHECK (issue_purpose IN ('partner_transfer','sale','other')),
  document_number text NOT NULL CONSTRAINT ck_trading_document_number_length CHECK (length(trim(document_number)) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'draft' CONSTRAINT ck_trading_document_status CHECK (status IN ('draft','pending_approval','approved','confirmed','cancelled','rejected')),
  created_by_sub text NOT NULL,
  confirmed_by_sub text,
  confirmed_at timestamptz(6),
  cancelled_at timestamptz(6),
  note text,
  correction_of_document_id uuid REFERENCES trading.document(id) ON DELETE RESTRICT,
  correction_reason text,
  correlation_id text NOT NULL,
  CONSTRAINT ck_trading_issue_type CHECK ((document_type = 'goods_issue') = (issue_purpose IS NOT NULL)),
  CONSTRAINT ck_trading_correction_pair CHECK ((correction_of_document_id IS NULL) = (correction_reason IS NULL)),
  CONSTRAINT ck_trading_correction_reason CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  CONSTRAINT ck_trading_confirm_actor CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL AND confirmed_by_sub IS NOT NULL)),
  CONSTRAINT uq_trading_document_number UNIQUE (document_type, document_number)
);
CREATE INDEX idx_trading_document_status_time ON trading.document(status, created_at DESC);
CREATE INDEX idx_trading_document_type_time ON trading.document(document_type, created_at DESC);
CREATE INDEX idx_trading_document_correction ON trading.document(correction_of_document_id);
CREATE UNIQUE INDEX uq_trading_one_active_correction ON trading.document(correction_of_document_id)
  WHERE correction_of_document_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE trading.document_line (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  document_id uuid NOT NULL REFERENCES trading.document(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CONSTRAINT ck_trading_line_number CHECK (line_no > 0),
  warehouse_id uuid NOT NULL REFERENCES inventory.warehouse(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  product_variant_id uuid NOT NULL REFERENCES catalog.product_variant(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES catalog.product(id) ON DELETE RESTRICT,
  quantity numeric(20,3) CONSTRAINT ck_trading_line_quantity CHECK (quantity >= 0),
  actual_quantity numeric(20,3) CONSTRAINT ck_trading_line_actual CHECK (actual_quantity >= 0),
  counted_quantity numeric(20,3) CONSTRAINT ck_trading_line_counted CHECK (counted_quantity >= 0),
  uom_id uuid NOT NULL REFERENCES catalog.uom(id) ON DELETE RESTRICT,
  source_issue_line_id uuid REFERENCES trading.document_line(id) ON DELETE RESTRICT,
  source_line_ref uuid,
  CONSTRAINT fk_trading_line_batch_variant FOREIGN KEY (batch_id, product_variant_id)
    REFERENCES catalog.batch(id, product_variant_id) ON DELETE RESTRICT,
  CONSTRAINT uq_trading_line_number UNIQUE (document_id, line_no),
  CONSTRAINT uq_trading_line_document UNIQUE (id, document_id)
);
CREATE UNIQUE INDEX uq_trading_line_issue ON trading.document_line(document_id, source_issue_line_id) WHERE source_issue_line_id IS NOT NULL;
CREATE UNIQUE INDEX uq_trading_line_ref ON trading.document_line(document_id, source_line_ref) WHERE source_line_ref IS NOT NULL;
CREATE INDEX idx_trading_line_batch_document ON trading.document_line(batch_id, document_id);

CREATE TABLE trading.transfer_detail (
  document_id uuid PRIMARY KEY REFERENCES trading.document(id) ON DELETE RESTRICT,
  linked_issue_id uuid NOT NULL REFERENCES trading.document(id) ON DELETE RESTRICT,
  destination_partner_id uuid NOT NULL REFERENCES system.partner(id) ON DELETE RESTRICT,
  delivery_state text NOT NULL DEFAULT 'pending' CONSTRAINT ck_trading_delivery_state CHECK (delivery_state IN ('pending','technical_ack','awaiting_receipt','received','partial','disputed')),
  technical_ack_at timestamptz(6),
  business_receipt_at timestamptz(6),
  CONSTRAINT uq_trading_transfer_issue UNIQUE (linked_issue_id)
);
CREATE TABLE trading.receiving_detail (
  document_id uuid PRIMARY KEY REFERENCES trading.document(id) ON DELETE RESTRICT,
  source_issuer_instance_id text NOT NULL,
  source_transfer_id text NOT NULL,
  inbound_message_id uuid,
  sent_quantity numeric(20,3) NOT NULL CONSTRAINT ck_trading_receiving_sent CHECK (sent_quantity > 0),
  actual_quantity numeric(20,3) CONSTRAINT ck_trading_receiving_actual CHECK (actual_quantity >= 0),
  discrepancy_reason text,
  CONSTRAINT uq_trading_receiving_source UNIQUE (source_issuer_instance_id, source_transfer_id)
);
CREATE TABLE trading.sale_detail (
  document_id uuid PRIMARY KEY REFERENCES trading.document(id) ON DELETE RESTRICT,
  linked_issue_id uuid NOT NULL REFERENCES trading.document(id) ON DELETE RESTRICT,
  buyer_ref text,
  sold_at timestamptz(6) NOT NULL,
  CONSTRAINT uq_trading_sale_issue UNIQUE (linked_issue_id)
);

ALTER TABLE inventory.stock_movement ADD CONSTRAINT fk_trading_movement_line
  FOREIGN KEY (source_line_id) REFERENCES trading.document_line(id) ON DELETE RESTRICT;
ALTER TABLE platform.approval_request ADD CONSTRAINT fk_trading_approval_document
  FOREIGN KEY (document_id) REFERENCES trading.document(id) ON DELETE RESTRICT;
COMMIT;

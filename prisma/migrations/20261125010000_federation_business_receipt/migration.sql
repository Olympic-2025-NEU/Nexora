-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE federation.business_receipt (
  id uuid PRIMARY KEY,
  transfer_id uuid NOT NULL UNIQUE REFERENCES trading.transfer_detail(document_id) ON DELETE RESTRICT,
  inbox_id uuid NOT NULL UNIQUE REFERENCES federation.inbox_message(id) ON DELETE RESTRICT,
  issuer_instance_id text NOT NULL,
  source_receiving_id uuid NOT NULL,
  sent_quantity numeric(20,3) NOT NULL CHECK (sent_quantity > 0),
  actual_quantity numeric(20,3) NOT NULL CHECK (actual_quantity >= 0 AND actual_quantity <= sent_quantity),
  discrepancy_quantity numeric(20,3) NOT NULL CHECK (discrepancy_quantity = sent_quantity - actual_quantity),
  discrepancy_reason text,
  received_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ck_business_receipt_reason CHECK (
    discrepancy_quantity = 0 OR NULLIF(btrim(discrepancy_reason), '') IS NOT NULL)
);
CREATE INDEX idx_business_receipt_received ON federation.business_receipt(received_at DESC);
CREATE TABLE federation.business_receipt_line (
  receipt_id uuid NOT NULL REFERENCES federation.business_receipt(id) ON DELETE RESTRICT,
  source_line_id uuid NOT NULL REFERENCES trading.document_line(id) ON DELETE RESTRICT,
  receiver_batch_id uuid NOT NULL,
  sent_quantity numeric(20,3) NOT NULL CHECK (sent_quantity > 0),
  actual_quantity numeric(20,3) NOT NULL CHECK (actual_quantity >= 0 AND actual_quantity <= sent_quantity),
  unit text NOT NULL CHECK (unit IN ('EA','KG','L')),
  PRIMARY KEY (receipt_id, source_line_id)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON federation.business_receipt, federation.business_receipt_line TO app_runtime;
  END IF;
END $$;
COMMIT;

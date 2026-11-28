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
CREATE INDEX idx_trading_transfer_partner ON trading.transfer_detail(destination_partner_id);
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

CREATE FUNCTION trading.guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'trading_confirm:immutable_document';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trading_guard_document BEFORE UPDATE OR DELETE ON trading.document
  FOR EACH ROW EXECUTE FUNCTION trading.guard_document();

CREATE FUNCTION trading.guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM trading.document WHERE id = OLD.document_id AND status = 'confirmed') THEN
      RAISE EXCEPTION 'trading_confirm:immutable_line';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM trading.document WHERE id = NEW.document_id AND status = 'confirmed'
      AND (TG_OP <> 'INSERT' OR xmin <> pg_current_xact_id()::text::xid)) THEN
      RAISE EXCEPTION 'trading_confirm:immutable_line';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trading_guard_line BEFORE INSERT OR UPDATE OR DELETE ON trading.document_line
  FOR EACH ROW EXECUTE FUNCTION trading.guard_line();

CREATE FUNCTION trading.guard_detail() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_type text; issue_type text; purpose text;
BEGIN
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM trading.document WHERE id = NEW.document_id AND status = 'confirmed'
    AND (TG_OP <> 'INSERT' OR xmin <> pg_current_xact_id()::text::xid))
     AND (TG_OP = 'INSERT' OR TG_TABLE_NAME <> 'transfer_detail' OR
       (TG_OP = 'UPDATE' AND NEW.document_id IS DISTINCT FROM OLD.document_id)) THEN
    RAISE EXCEPTION 'trading_confirm:immutable_detail';
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM trading.document WHERE id = OLD.document_id AND status = 'confirmed') THEN
    IF TG_TABLE_NAME <> 'transfer_detail' OR TG_OP = 'DELETE' OR
       ROW(NEW.document_id, NEW.linked_issue_id, NEW.destination_partner_id) IS DISTINCT FROM
       ROW(OLD.document_id, OLD.linked_issue_id, OLD.destination_partner_id) THEN
      RAISE EXCEPTION 'trading_confirm:immutable_detail';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT document_type INTO doc_type FROM trading.document WHERE id = NEW.document_id;
  IF (TG_TABLE_NAME = 'transfer_detail' AND doc_type IS DISTINCT FROM 'partner_transfer') OR
     (TG_TABLE_NAME = 'sale_detail' AND doc_type IS DISTINCT FROM 'sale_record') OR
     (TG_TABLE_NAME = 'receiving_detail' AND doc_type IS DISTINCT FROM 'receiving_confirmation') THEN
    RAISE EXCEPTION 'trading_confirm:detail_type';
  END IF;
  IF TG_TABLE_NAME IN ('transfer_detail', 'sale_detail') THEN
    SELECT document_type, issue_purpose INTO issue_type, purpose
      FROM trading.document WHERE id = NEW.linked_issue_id;
    IF issue_type IS DISTINCT FROM 'goods_issue' OR
       (TG_TABLE_NAME = 'transfer_detail' AND purpose IS DISTINCT FROM 'partner_transfer') OR
       (TG_TABLE_NAME = 'sale_detail' AND purpose IS DISTINCT FROM 'sale') THEN
      RAISE EXCEPTION 'trading_confirm:issue_purpose';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trading_guard_transfer BEFORE INSERT OR UPDATE OR DELETE ON trading.transfer_detail
  FOR EACH ROW EXECUTE FUNCTION trading.guard_detail();
CREATE TRIGGER trg_trading_guard_receiving BEFORE INSERT OR UPDATE OR DELETE ON trading.receiving_detail
  FOR EACH ROW EXECUTE FUNCTION trading.guard_detail();
CREATE TRIGGER trg_trading_guard_sale BEFORE INSERT OR UPDATE OR DELETE ON trading.sale_detail
  FOR EACH ROW EXECUTE FUNCTION trading.guard_detail();

CREATE FUNCTION trading.validate_confirmed_document(doc_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE doc trading.document%ROWTYPE; detail RECORD;
BEGIN
  SELECT * INTO doc FROM trading.document WHERE id = doc_id;
  IF NOT FOUND OR doc.status <> 'confirmed' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM trading.document_line WHERE document_id = doc_id) THEN
    RAISE EXCEPTION 'trading_confirm:no_lines';
  END IF;
  IF EXISTS (
    SELECT 1 FROM trading.document_line l
    WHERE l.document_id = doc_id AND (
      (doc.document_type = 'stocktake' AND l.counted_quantity IS NULL) OR
      (doc.document_type <> 'stocktake' AND l.quantity IS NULL) OR
      (doc.document_type = 'receiving_confirmation' AND (l.actual_quantity IS NULL OR l.source_line_ref IS NULL)) OR
      (doc.document_type IN ('partner_transfer','sale_record') AND l.source_issue_line_id IS NULL)
    )
  ) THEN RAISE EXCEPTION 'trading_confirm:missing_line_field'; END IF;
  IF EXISTS (
    SELECT 1 FROM trading.document_line l
    JOIN catalog.product_variant v ON v.id = l.product_variant_id
    JOIN catalog.batch b ON b.id = l.batch_id
    WHERE l.document_id = doc_id AND (l.product_id <> v.product_id OR b.product_id <> v.product_id)
  ) THEN RAISE EXCEPTION 'trading_confirm:product_mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM trading.document_line l WHERE l.document_id = doc_id
      AND NOT EXISTS (SELECT 1 FROM catalog.product_variant_uom u
        WHERE u.product_variant_id = l.product_variant_id AND u.uom_id = l.uom_id)
  ) THEN RAISE EXCEPTION 'trading_confirm:uom_not_allowed'; END IF;

  IF doc.document_type IN ('partner_transfer','sale_record') THEN
    IF doc.document_type = 'partner_transfer' THEN
      SELECT linked_issue_id AS issue_id INTO detail FROM trading.transfer_detail WHERE document_id = doc_id;
    ELSE
      SELECT linked_issue_id AS issue_id INTO detail FROM trading.sale_detail WHERE document_id = doc_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'trading_confirm:missing_detail'; END IF;
    IF NOT EXISTS (SELECT 1 FROM trading.document WHERE id = detail.issue_id AND status = 'confirmed') THEN
      RAISE EXCEPTION 'trading_confirm:issue_not_confirmed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM trading.document_line l
      LEFT JOIN trading.document_line s ON s.id = l.source_issue_line_id AND s.document_id = detail.issue_id
      WHERE l.document_id = doc_id AND (s.id IS NULL OR
        ROW(l.line_no,l.warehouse_id,l.batch_id,l.product_variant_id,l.product_id,l.uom_id,l.quantity)
        IS DISTINCT FROM ROW(s.line_no,s.warehouse_id,s.batch_id,s.product_variant_id,s.product_id,s.uom_id,s.quantity))
    ) OR EXISTS (
      SELECT 1 FROM trading.document_line s WHERE s.document_id = detail.issue_id
        AND NOT EXISTS (SELECT 1 FROM trading.document_line l WHERE l.document_id = doc_id AND l.source_issue_line_id = s.id)
    ) THEN RAISE EXCEPTION 'trading_confirm:line_mismatch'; END IF;
  ELSIF doc.document_type = 'receiving_confirmation' THEN
    SELECT * INTO detail FROM trading.receiving_detail WHERE document_id = doc_id;
    IF NOT FOUND OR detail.actual_quantity IS NULL THEN RAISE EXCEPTION 'trading_confirm:missing_detail'; END IF;
    IF EXISTS (SELECT 1 FROM trading.document_line l WHERE l.document_id = doc_id AND l.actual_quantity > l.quantity)
       OR detail.actual_quantity > detail.sent_quantity THEN
      RAISE EXCEPTION 'trading_confirm:actual_out_of_range';
    END IF;
    IF detail.sent_quantity <> (SELECT sum(quantity) FROM trading.document_line WHERE document_id = doc_id)
       OR detail.actual_quantity <> (SELECT sum(actual_quantity) FROM trading.document_line WHERE document_id = doc_id) THEN
      RAISE EXCEPTION 'trading_confirm:receiving_total_mismatch';
    END IF;
    IF detail.actual_quantity <> detail.sent_quantity AND nullif(trim(detail.discrepancy_reason), '') IS NULL THEN
      RAISE EXCEPTION 'trading_confirm:discrepancy_reason_required';
    END IF;
  END IF;
END $$;

CREATE FUNCTION trading.check_touched_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'document' THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM trading.validate_confirmed_document(OLD.id);
    ELSE
      PERFORM trading.validate_confirmed_document(NEW.id);
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM trading.validate_confirmed_document(OLD.document_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM trading.validate_confirmed_document(NEW.document_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_trading_check_document AFTER INSERT OR UPDATE OR DELETE ON trading.document
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_touched_document();
CREATE CONSTRAINT TRIGGER trg_trading_check_line AFTER INSERT OR UPDATE OR DELETE ON trading.document_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_touched_document();
CREATE CONSTRAINT TRIGGER trg_trading_check_transfer AFTER INSERT OR UPDATE OR DELETE ON trading.transfer_detail
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_touched_document();
CREATE CONSTRAINT TRIGGER trg_trading_check_receiving AFTER INSERT OR UPDATE OR DELETE ON trading.receiving_detail
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_touched_document();
CREATE CONSTRAINT TRIGGER trg_trading_check_sale AFTER INSERT OR UPDATE OR DELETE ON trading.sale_detail
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_touched_document();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA trading TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON trading.document, trading.document_line, trading.transfer_detail, trading.receiving_detail TO app_runtime;
    GRANT SELECT, INSERT, DELETE ON trading.sale_detail TO app_runtime;
    GRANT DELETE ON trading.document_line, trading.transfer_detail, trading.receiving_detail TO app_runtime;
  END IF;
END $$;
COMMIT;

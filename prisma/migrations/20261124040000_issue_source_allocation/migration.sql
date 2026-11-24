-- SPDX-License-Identifier: AGPL-3.0-only
-- P08-T01 closure: declared receipt/receiving-line provenance for M03 issues.
BEGIN;

CREATE TABLE trading.issue_source_allocation (
  id uuid PRIMARY KEY,
  issue_line_id uuid NOT NULL REFERENCES trading.document_line(id) ON DELETE RESTRICT,
  source_line_id uuid NOT NULL REFERENCES trading.document_line(id) ON DELETE RESTRICT,
  quantity numeric(20,3) NOT NULL CONSTRAINT ck_issue_source_quantity CHECK (quantity > 0),
  CONSTRAINT ck_issue_source_distinct CHECK (issue_line_id <> source_line_id),
  CONSTRAINT uq_issue_source_pair UNIQUE (issue_line_id, source_line_id)
);
CREATE INDEX idx_issue_source_line ON trading.issue_source_allocation(source_line_id);

CREATE FUNCTION trading.guard_issue_source_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue_line trading.document_line%ROWTYPE;
        source_line trading.document_line%ROWTYPE;
        issue_doc trading.document%ROWTYPE;
        source_doc trading.document%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT d.* INTO issue_doc FROM trading.document d
      JOIN trading.document_line l ON l.document_id = d.id WHERE l.id = OLD.issue_line_id;
    IF issue_doc.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'issue_source:immutable_after_draft';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO issue_line FROM trading.document_line WHERE id = NEW.issue_line_id;
  SELECT * INTO source_line FROM trading.document_line WHERE id = NEW.source_line_id;
  SELECT * INTO issue_doc FROM trading.document WHERE id = issue_line.document_id;
  SELECT * INTO source_doc FROM trading.document WHERE id = source_line.document_id;
  IF issue_doc.document_type IS DISTINCT FROM 'goods_issue' OR issue_doc.status IS DISTINCT FROM 'draft' OR
     source_doc.document_type NOT IN ('goods_receipt','receiving_confirmation') OR
     source_doc.status IS DISTINCT FROM 'confirmed' OR
     ROW(issue_line.warehouse_id,issue_line.batch_id,issue_line.product_id,issue_line.product_variant_id)
       IS DISTINCT FROM ROW(source_line.warehouse_id,source_line.batch_id,
         source_line.product_id,source_line.product_variant_id) THEN
    RAISE EXCEPTION 'issue_source:invalid_source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_issue_source_guard BEFORE INSERT OR UPDATE OR DELETE
  ON trading.issue_source_allocation FOR EACH ROW
  EXECUTE FUNCTION trading.guard_issue_source_allocation();

CREATE FUNCTION trading.validate_issue_source_allocations(doc_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE doc trading.document%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM trading.document WHERE id = doc_id;
  IF NOT FOUND OR doc.document_type <> 'goods_issue' OR doc.status <> 'confirmed' OR
     NOT EXISTS (SELECT 1 FROM trading.issue_source_allocation a
       JOIN trading.document_line l ON l.id = a.issue_line_id WHERE l.document_id = doc_id) THEN
    RETURN; -- Existing/unallocated issues retain an explicit unknown-source gap.
  END IF;
  IF EXISTS (
    SELECT 1 FROM trading.document_line l
    LEFT JOIN trading.issue_source_allocation a ON a.issue_line_id = l.id
    WHERE l.document_id = doc_id GROUP BY l.id, l.quantity
    HAVING COALESCE(sum(a.quantity), 0) <> l.quantity
  ) THEN RAISE EXCEPTION 'issue_source:incomplete_allocation'; END IF;
  IF EXISTS (
    SELECT 1 FROM trading.issue_source_allocation a
    JOIN trading.document_line l ON l.id = a.issue_line_id
    JOIN trading.document_line s ON s.id = a.source_line_id
    JOIN trading.document sd ON sd.id = s.document_id
    JOIN catalog.uom u ON u.id = s.uom_id
    WHERE l.document_id = doc_id AND (
      sd.status <> 'confirmed' OR sd.document_type NOT IN ('goods_receipt','receiving_confirmation') OR
      (u.kind = 'count' AND a.quantity <> trunc(a.quantity)) OR
      ROW(l.warehouse_id,l.batch_id,l.product_id,l.product_variant_id,l.uom_id)
        IS DISTINCT FROM ROW(s.warehouse_id,s.batch_id,s.product_id,s.product_variant_id,s.uom_id)
    )
  ) THEN RAISE EXCEPTION 'issue_source:invalid_source'; END IF;
  IF EXISTS (
    SELECT 1 FROM trading.issue_source_allocation a
    JOIN trading.document_line l ON l.id = a.issue_line_id
    JOIN trading.document d ON d.id = l.document_id AND d.status = 'confirmed'
    JOIN trading.document_line s ON s.id = a.source_line_id
    JOIN trading.document sd ON sd.id = s.document_id
    WHERE a.source_line_id IN (
      SELECT x.source_line_id FROM trading.issue_source_allocation x
      JOIN trading.document_line il ON il.id = x.issue_line_id WHERE il.document_id = doc_id
    )
    GROUP BY a.source_line_id, s.quantity, s.actual_quantity, sd.document_type
    HAVING sum(a.quantity) > CASE WHEN sd.document_type = 'receiving_confirmation'
      THEN s.actual_quantity ELSE s.quantity END
  ) THEN RAISE EXCEPTION 'issue_source:overallocated'; END IF;
END $$;

CREATE FUNCTION trading.check_issue_source_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_doc uuid;
BEGIN
  IF TG_TABLE_NAME = 'document' THEN target_doc := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT document_id INTO target_doc FROM trading.document_line WHERE id = OLD.issue_line_id;
  ELSE
    SELECT document_id INTO target_doc FROM trading.document_line WHERE id = NEW.issue_line_id;
  END IF;
  IF target_doc IS NOT NULL THEN PERFORM trading.validate_issue_source_allocations(target_doc); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_check_issue_sources_document AFTER UPDATE ON trading.document
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_issue_source_allocations();
CREATE CONSTRAINT TRIGGER trg_check_issue_sources_allocation
  AFTER INSERT OR UPDATE OR DELETE ON trading.issue_source_allocation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trading.check_issue_source_allocations();

ALTER TABLE traceability.trace_link ADD COLUMN allocation_detail jsonb;
ALTER TABLE traceability.trace_link ADD CONSTRAINT ck_trace_link_allocation_detail
  CHECK (allocation_detail IS NULL OR
    (relation = 'derived_from' AND to_event_id IS NOT NULL AND
     jsonb_typeof(allocation_detail) = 'array' AND jsonb_array_length(allocation_detail) > 0));

GRANT SELECT, INSERT, DELETE ON trading.issue_source_allocation TO app_runtime;
COMMIT;

-- SPDX-License-Identifier: AGPL-3.0-only
ALTER TABLE trading.sale_detail DROP CONSTRAINT uq_trading_sale_issue;
CREATE INDEX idx_trading_sale_issue ON trading.sale_detail(linked_issue_id);

CREATE FUNCTION trading.check_active_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'document' THEN
    SELECT linked_issue_id INTO issue_id FROM trading.sale_detail WHERE document_id = NEW.id;
  ELSE
    issue_id := NEW.linked_issue_id;
  END IF;
  IF issue_id IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM trading.document WHERE id = issue_id FOR UPDATE;
  IF (SELECT count(*) FROM trading.sale_detail s
      JOIN trading.document d ON d.id = s.document_id
      WHERE s.linked_issue_id = issue_id AND d.status <> 'cancelled') > 1 THEN
    RAISE EXCEPTION 'trading_sale:already_exists' USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_trading_active_sale_detail
  AFTER INSERT OR UPDATE ON trading.sale_detail DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_sale();
CREATE CONSTRAINT TRIGGER trg_trading_active_sale_document
  AFTER UPDATE OF status ON trading.document DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_sale();

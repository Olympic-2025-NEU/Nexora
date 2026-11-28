-- SPDX-License-Identifier: AGPL-3.0-only
ALTER TABLE trading.transfer_detail DROP CONSTRAINT uq_trading_transfer_issue;
CREATE INDEX idx_trading_transfer_issue ON trading.transfer_detail(linked_issue_id);

CREATE FUNCTION trading.check_active_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'document' THEN
    SELECT linked_issue_id INTO issue_id FROM trading.transfer_detail WHERE document_id = NEW.id;
  ELSE
    issue_id := NEW.linked_issue_id;
  END IF;
  IF issue_id IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM trading.document WHERE id = issue_id FOR UPDATE;
  IF (SELECT count(*) FROM trading.transfer_detail t
      JOIN trading.document d ON d.id = t.document_id
      WHERE t.linked_issue_id = issue_id AND d.status <> 'cancelled') > 1 THEN
    RAISE EXCEPTION 'trading_transfer:already_exists' USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_trading_active_transfer_detail
  AFTER INSERT OR UPDATE ON trading.transfer_detail DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_transfer();
CREATE CONSTRAINT TRIGGER trg_trading_active_transfer_document
  AFTER UPDATE OF status ON trading.document DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_transfer();

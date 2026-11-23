-- SPDX-License-Identifier: AGPL-3.0-only
ALTER TABLE trading.receiving_detail DROP CONSTRAINT uq_trading_receiving_source;
CREATE INDEX idx_trading_receiving_source ON trading.receiving_detail(source_issuer_instance_id, source_transfer_id);

CREATE FUNCTION trading.check_active_receiving() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_issuer text; source_transfer text;
BEGIN
  IF TG_TABLE_NAME = 'document' THEN
    SELECT source_issuer_instance_id, source_transfer_id INTO source_issuer, source_transfer
      FROM trading.receiving_detail WHERE document_id = NEW.id;
  ELSE
    source_issuer := NEW.source_issuer_instance_id;
    source_transfer := NEW.source_transfer_id;
  END IF;
  IF source_issuer IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(source_issuer || ':' || source_transfer, 0));
  IF (SELECT count(*) FROM trading.receiving_detail r
      JOIN trading.document d ON d.id = r.document_id
      WHERE r.source_issuer_instance_id = source_issuer AND r.source_transfer_id = source_transfer
        AND d.status <> 'cancelled') > 1 THEN
    RAISE EXCEPTION 'trading_receiving:already_exists' USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_trading_active_receiving_detail
  AFTER INSERT OR UPDATE ON trading.receiving_detail DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_receiving();
CREATE CONSTRAINT TRIGGER trg_trading_active_receiving_document
  AFTER UPDATE OF status ON trading.document DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trading.check_active_receiving();

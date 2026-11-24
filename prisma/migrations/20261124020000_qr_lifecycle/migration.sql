-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
ALTER TABLE traceability.qr_token
  ADD COLUMN policy_version text,
  ADD COLUMN issuance_key_hash char(64);
ALTER TABLE traceability.qr_token
  ADD CONSTRAINT ck_qr_issuance_key CHECK (
    issuance_key_hash IS NULL OR issuance_key_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX uq_qr_issuance_key ON traceability.qr_token(issuance_key_hash)
  WHERE issuance_key_hash IS NOT NULL;

-- Replacing/revoking a publication cannot leave an old QR marked active.
CREATE FUNCTION traceability.revoke_qr_on_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'revoked' OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    UPDATE traceability.qr_token SET state = 'revoked', revoked_at = now()
      WHERE batch_id = NEW.batch_id AND state = 'active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_qr_revoke_on_projection AFTER UPDATE ON traceability.passport_projection
  FOR EACH ROW WHEN (NEW.state = 'revoked' OR NEW.policy_version IS DISTINCT FROM OLD.policy_version)
  EXECUTE FUNCTION traceability.revoke_qr_on_projection();
COMMIT;

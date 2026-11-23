-- SPDX-License-Identifier: AGPL-3.0-only
-- Keep the already deployed platform baseline immutable. Hashes carry no raw key.
BEGIN;
ALTER TABLE "platform"."attachment"
    ADD COLUMN "upload_key_hash" CHAR(64),
    ADD COLUMN "upload_payload_hash" CHAR(64),
    ADD CONSTRAINT "attachment_upload_hash_pair_check"
      CHECK (("upload_key_hash" IS NULL) = ("upload_payload_hash" IS NULL)),
    ADD CONSTRAINT "attachment_upload_key_hash_check"
      CHECK ("upload_key_hash" IS NULL OR "upload_key_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "attachment_upload_payload_hash_check"
      CHECK ("upload_payload_hash" IS NULL OR "upload_payload_hash" ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX "attachment_upload_key_hash_key" ON "platform"."attachment"("upload_key_hash");
-- Core verifies membership but never administers identities.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "system"."organization", "system"."membership" FROM core_data;
COMMIT;

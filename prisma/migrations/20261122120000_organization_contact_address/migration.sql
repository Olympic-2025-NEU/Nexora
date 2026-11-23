-- SPDX-License-Identifier: AGPL-3.0-only
-- Organization contact enrichment: optional address + phone for admin profile UI.
BEGIN;

ALTER TABLE "system"."organization"
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT;

ALTER TABLE "system"."organization"
  DROP CONSTRAINT IF EXISTS "organization_contact_phone_len";
ALTER TABLE "system"."organization"
  ADD CONSTRAINT "organization_contact_phone_len"
  CHECK ("contact_phone" IS NULL OR length(trim("contact_phone")) BETWEEN 1 AND 40);

ALTER TABLE "system"."organization"
  DROP CONSTRAINT IF EXISTS "organization_address_len";
ALTER TABLE "system"."organization"
  ADD CONSTRAINT "organization_address_len"
  CHECK ("address" IS NULL OR length(trim("address")) BETWEEN 1 AND 500);

COMMIT;

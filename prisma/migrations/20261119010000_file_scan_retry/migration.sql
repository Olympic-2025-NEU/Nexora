-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
ALTER TABLE "platform"."attachment"
  ADD COLUMN "scan_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scan_error_code" TEXT,
  ADD COLUMN "next_scan_at" TIMESTAMPTZ(6),
  ADD COLUMN "scan_lease_id" UUID,
  ADD COLUMN "scan_lease_until" TIMESTAMPTZ(6),
  ADD COLUMN "quarantine_purged_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "attachment_scan_attempts_check" CHECK ("scan_attempts" BETWEEN 0 AND 5),
  ADD CONSTRAINT "attachment_scan_lease_pair_check" CHECK (("scan_lease_id" IS NULL) = ("scan_lease_until" IS NULL)),
  ADD CONSTRAINT "attachment_scan_error_code_check" CHECK ("scan_error_code" IS NULL OR "scan_error_code" IN ('SCANNER_UNAVAILABLE', 'SCANNER_TIMEOUT', 'SCANNER_PROTOCOL', 'SCANNER_SIGNATURE_STALE', 'FILE_STORAGE_ERROR', 'FILE_INTEGRITY_ERROR')),
  ADD CONSTRAINT "attachment_quarantine_purged_state_check" CHECK ("quarantine_purged_at" IS NULL OR ("scan_state" = 'infected' AND "bucket" = 'quarantine'));
CREATE INDEX "attachment_scan_due_idx" ON "platform"."attachment"("scan_state", "next_scan_at")
  WHERE "scan_state" IN ('pending', 'error');
COMMIT;

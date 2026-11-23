-- SPDX-License-Identifier: AGPL-3.0-only
-- P06 follow-up: enforce movement delta sign by kind (schema-v1).
BEGIN;

ALTER TABLE "inventory"."stock_movement"
  ADD CONSTRAINT "stock_movement_delta_sign_check" CHECK (
    (kind = 'issue' AND delta < 0)
    OR (kind IN ('receipt', 'receiving') AND delta > 0)
    OR (kind = 'stocktake' AND delta <> 0)
  );

COMMIT;

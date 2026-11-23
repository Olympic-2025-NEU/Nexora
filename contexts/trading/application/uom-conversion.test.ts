// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { convertToStock } from "./uom-conversion";
import { checkLines } from "./checklist";

const uoms = [{ uomId: "stock", isStockKeeping: true, factorToStockUom: "1" },
  { uomId: "pack", isStockKeeping: false, factorToStockUom: "0.125" }];
test("conversion rounds once and stock form is idempotent", () => {
  const result = convertToStock("1.005", "pack", uoms);
  assert.equal(result.stockQuantity, "0.126");
  assert.deepEqual(convertToStock(result.stockQuantity, result.stockUomId, uoms), result);
  assert.throws(() => convertToStock("0.001", "pack", [{ ...uoms[0] }, { ...uoms[1], factorToStockUom: "0.001" }]),
    { code: "CONVERSION_ROUNDS_TO_ZERO" });
});
test("confirm checklist rejects missing or duplicate lines", () => {
  assert.throws(() => checkLines([]), { code: "NO_LINES" });
  const line = { lineNo: 1, warehouseId: "w", batchId: "b", productVariantId: "v", productId: "p", uomId: "u", quantity: "1" };
  assert.throws(() => checkLines([line, line]), { code: "LINE_NUMBER_INVALID" });
  assert.throws(() => checkLines([{ ...line, quantity: null }]), { code: "MISSING_LINE_FIELD" });
});

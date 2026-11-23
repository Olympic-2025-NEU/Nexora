// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { convertToStock } from "./uom-conversion";
import { aggregateDemand, checkLines } from "./checklist";
import { Decimal } from "@prisma/client/runtime/library";

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
test("two individually affordable lines aggregate before balance check", () => {
  const demand = aggregateDemand(["12", "12"].map((quantity) => ({
    warehouseId: "w", batchId: "b", quantity: new Decimal(quantity),
  })));
  assert.equal(demand.length, 1);
  assert.equal(demand[0]!.requested.toFixed(3), "24.000");
  assert.ok(demand[0]!.requested.gt(new Decimal(20)));
});

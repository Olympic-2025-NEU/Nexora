// SPDX-License-Identifier: AGPL-3.0-only
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";

export type VariantUom = { uomId: string; isStockKeeping: boolean; factorToStockUom: string };

export function convertToStock(quantity: string, uomId: string, uoms: readonly VariantUom[]) {
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(quantity)) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  const source = uoms.find((row) => row.uomId === uomId);
  const stock = uoms.find((row) => row.isStockKeeping);
  if (!source || !stock || new Decimal(source.factorToStockUom).lte(0)) {
    throw new DomainError("UOM_NOT_ON_VARIANT", 422);
  }
  const result = new Decimal(quantity).mul(source.factorToStockUom).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  if (new Decimal(quantity).lte(0)) throw new DomainError("QUANTITY_NOT_POSITIVE", 422);
  if (result.isZero()) throw new DomainError("CONVERSION_ROUNDS_TO_ZERO", 422);
  if (result.gte("100000000000000000")) throw new DomainError("QUANTITY_OVERFLOW", 422);
  return { stockQuantity: result.toFixed(3), stockUomId: stock.uomId };
}

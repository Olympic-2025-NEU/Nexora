// SPDX-License-Identifier: AGPL-3.0-only
import type {
  StockBalanceRecord,
  StockMovementRecord,
  WarehouseRecord,
} from "../domain/types";

export function projectWarehouse(warehouse: WarehouseRecord) {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    status: warehouse.status,
    version: warehouse.version,
  };
}

export function projectBalance(balance: StockBalanceRecord) {
  return {
    warehouseId: balance.warehouseId,
    productId: balance.productId,
    productVariantId: balance.productVariantId,
    batchId: balance.batchId,
    quantity: balance.quantity.toFixed(),
    stockUomId: balance.stockUomId,
    unitKind: balance.unitKind,
    updatedAt: balance.updatedAt.toISOString(),
  };
}

export function projectMovement(movement: StockMovementRecord) {
  return {
    id: movement.id,
    kind: movement.kind,
    productVariantId: movement.productVariantId,
    delta: movement.delta.toFixed(),
    balanceAfter: movement.balanceAfter.toFixed(),
    sourceDocumentId: movement.sourceLineId,
    createdAt: movement.createdAt.toISOString(),
  };
}

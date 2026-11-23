// SPDX-License-Identifier: AGPL-3.0-only
import type { Decimal } from "@prisma/client/runtime/library";

export type WarehouseStatus = "active" | "archived";
export type MovementKind = "receipt" | "issue" | "receiving" | "stocktake";

export type WarehouseRecord = {
  id: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  version: number;
  createdBySub: string;
};

export type StockBalanceRecord = {
  warehouseId: string;
  batchId: string;
  productId: string;
  productVariantId: string;
  /** Stock-keeping UOM id for the variant. */
  stockUomId: string;
  /** UOM kind for quantity rules (count | mass | volume). */
  unitKind: "count" | "mass" | "volume";
  quantity: Decimal;
  version: number;
  updatedAt: Date;
};

export type StockMovementRecord = {
  id: string;
  createdAt: Date;
  warehouseId: string;
  batchId: string;
  productId: string;
  productVariantId: string;
  sourceLineId: string;
  kind: MovementKind;
  delta: Decimal;
  balanceAfter: Decimal;
  actorSub: string;
  correlationId: string;
  reversalOf: string | null;
};

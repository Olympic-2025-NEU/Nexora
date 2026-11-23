// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";
import {
  addQuantity,
  parseQuantity,
  toUomKind,
  type QuantityUnit,
} from "@/contexts/catalog/domain/quantity";
import type { UomKind } from "@/contexts/catalog/domain/types";
import type { MovementKind, StockMovementRecord } from "../domain/types";
import { mapMovement } from "../infrastructure/prisma-repos";
import { todayInTimezone } from "./warehouse-scope";

type Tx = Prisma.TransactionClient;

export type AdjustStockInput = {
  warehouseId: string;
  batchId: string;
  productId: string;
  productVariantId: string;
  /** Idempotency anchor: one movement per (sourceLineId, kind). */
  sourceLineId: string;
  kind: MovementKind;
  /**
   * Signed delta. String form requires stock UOM kind (count/mass/volume).
   * Quantities are always in the variant stock-keeping UOM.
   */
  delta: Decimal | string;
  /** Optional; must match stock UOM kind when provided. */
  unit?: QuantityUnit;
  actorSub: string;
  correlationId: string;
  now?: Date;
  timezone?: string;
};

export type AdjustStockResult = {
  movement: StockMovementRecord;
  replayed: boolean;
};

export type OpenStockBalanceInput = Omit<AdjustStockInput, "kind" | "delta"> & {
  quantity: Decimal | string;
};

type BalanceKey = { warehouseId: string; batchId: string };

function isPrismaUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function sameMovement(
  existing: {
    warehouseId: string;
    batchId: string;
    productId: string;
    productVariantId: string;
    delta: Decimal;
    actorSub: string;
  },
  input: AdjustStockInput,
  delta: Decimal,
): boolean {
  return (
    existing.warehouseId === input.warehouseId &&
    existing.batchId === input.batchId &&
    existing.productId === input.productId &&
    existing.productVariantId === input.productVariantId &&
    existing.delta.eq(delta) &&
    existing.actorSub === input.actorSub
  );
}

export async function findBalancesOrdered(tx: Tx, keys: readonly BalanceKey[]) {
  if (keys.length === 0) return [];
  return tx.stockBalance.findMany({
    where: { OR: keys.map((k) => ({ warehouseId: k.warehouseId, batchId: k.batchId })) },
    orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }],
  });
}

export async function adjustStock(tx: Tx, input: AdjustStockInput): Promise<AdjustStockResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { isActive: true, deletedAt: true },
  });
  if (!product) throw new DomainError("PRODUCT_NOT_FOUND", 404);
  if ((!product.isActive || product.deletedAt) && input.kind !== "issue") {
    throw new DomainError("PRODUCT_ARCHIVED", 409);
  }

  const stockUom = await tx.productVariantUom.findFirst({
    where: { productVariantId: input.productVariantId, isStockKeeping: true },
    include: { uom: { select: { kind: true } } },
  });
  if (!stockUom) throw new DomainError("VARIANT_STOCK_UOM_MISSING", 422);
  const stockKind = stockUom.uom.kind as UomKind;
  if (input.unit !== undefined && toUomKind(input.unit) !== stockKind) {
    throw new DomainError("QUANTITY_UNIT_MISMATCH", 422);
  }

  const delta =
    typeof input.delta === "string"
      ? parseQuantity(input.delta, stockKind)
      : parseQuantity(input.delta.toFixed(), stockKind);
  if (delta.isZero()) throw new DomainError("QUANTITY_ZERO", 422);
  if ((input.kind === "receipt" || input.kind === "receiving") && delta.lte(0)) {
    throw new DomainError("QUANTITY_NOT_POSITIVE", 422);
  }
  if (input.kind === "issue" && delta.gte(0)) {
    throw new DomainError("QUANTITY_NOT_NEGATIVE", 422);
  }

  const existing = await tx.stockMovement.findUnique({
    where: { sourceLineId_kind: { sourceLineId: input.sourceLineId, kind: input.kind } },
  });
  if (existing) {
    if (!sameMovement(existing, input, delta)) {
      throw new DomainError("STOCK_MOVEMENT_CONFLICT", 409);
    }
    return { movement: mapMovement(existing), replayed: true };
  }

  const warehouse = await tx.warehouse.findUnique({
    where: { id: input.warehouseId },
    select: { status: true },
  });
  if (!warehouse) throw new DomainError("WAREHOUSE_NOT_FOUND", 404);
  if (warehouse.status !== "active" && delta.gt(0)) {
    throw new DomainError("WAREHOUSE_ARCHIVED", 409);
  }

  const batch = await tx.batch.findUnique({
    where: { id: input.batchId },
    select: { productId: true, productVariantId: true, qualityStatus: true, expiresOn: true },
  });
  if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);
  if (batch.productId !== input.productId || batch.productVariantId !== input.productVariantId) {
    throw new DomainError("BATCH_PRODUCT_MISMATCH", 422);
  }

  if (input.kind === "issue") {
    if (batch.qualityStatus === "restricted" || batch.qualityStatus === "inspect") {
      throw new DomainError("BATCH_QUALITY_BLOCKED", 409);
    }
    if (batch.expiresOn) {
      const timezone =
        input.timezone ??
        (
          await tx.organization.findUnique({
            where: { singletonSlot: 1 },
            select: { timezone: true },
          })
        )?.timezone ??
        "UTC";
      const today = todayInTimezone(timezone, input.now ?? new Date());
      if (batch.expiresOn.toISOString().slice(0, 10) < today) {
        throw new DomainError("BATCH_EXPIRED", 409);
      }
    }
  }

  const key = { warehouseId: input.warehouseId, batchId: input.batchId };
  const balance = await tx.stockBalance.findUnique({
    where: { warehouseId_batchId: key },
  });

  if (delta.lt(0)) {
    const needed = delta.abs();
    if (!balance || balance.quantity.lt(needed)) {
      throw new DomainError("INSUFFICIENT_STOCK", 409);
    }
    const updated = await tx.stockBalance.updateMany({
      where: { ...key, quantity: { gte: needed } },
      data: { quantity: { decrement: needed }, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (updated.count !== 1) throw new DomainError("INSUFFICIENT_STOCK", 409);
  } else {
    const current = balance?.quantity ?? new Decimal(0);
    addQuantity(current, delta);
    if (!balance) {
      await tx.stockBalance.createMany({
        data: [
          {
            ...key,
            productId: input.productId,
            productVariantId: input.productVariantId,
            quantity: new Decimal(0),
          },
        ],
        skipDuplicates: true,
      });
    }
    const updated = await tx.stockBalance.updateMany({
      where: key,
      data: { quantity: { increment: delta }, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (updated.count !== 1) throw new DomainError("STOCK_BALANCE_CONFLICT", 409);
  }

  const after = await tx.stockBalance.findUniqueOrThrow({
    where: { warehouseId_batchId: key },
    select: { quantity: true },
  });

  try {
    const row = await tx.stockMovement.create({
      data: {
        id: randomUUID(),
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        productId: input.productId,
        productVariantId: input.productVariantId,
        sourceLineId: input.sourceLineId,
        kind: input.kind,
        delta,
        balanceAfter: after.quantity,
        actorSub: input.actorSub,
        correlationId: input.correlationId,
      },
    });
    return { movement: mapMovement(row), replayed: false };
  } catch (err) {
    if (isPrismaUnique(err)) {
      const again = await tx.stockMovement.findUnique({
        where: { sourceLineId_kind: { sourceLineId: input.sourceLineId, kind: input.kind } },
      });
      if (again && sameMovement(again, input, delta)) {
        return { movement: mapMovement(again), replayed: true };
      }
      throw new DomainError("STOCK_MOVEMENT_CONFLICT", 409);
    }
    throw err;
  }
}

export async function openStockBalance(
  tx: Tx,
  input: OpenStockBalanceInput,
): Promise<AdjustStockResult> {
  const { quantity, ...rest } = input;
  return adjustStock(tx, {
    ...rest,
    kind: "receipt",
    delta: typeof quantity === "string" ? quantity : quantity.toFixed(),
    unit: input.unit,
  });
}

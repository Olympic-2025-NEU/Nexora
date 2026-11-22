// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";
import { addQuantity, parseQuantity, type BaseUnit } from "@/contexts/catalog/domain/quantity";
import type { MovementKind, StockMovementRecord } from "../domain/types";
import { mapMovement } from "../infrastructure/prisma-repos";
import { todayInTimezone } from "./warehouse-scope";

type Tx = Prisma.TransactionClient;

export type AdjustStockInput = {
  warehouseId: string;
  batchId: string;
  productId: string;
  /** Idempotency anchor: one movement per (sourceLineId, kind). */
  sourceLineId: string;
  kind: MovementKind;
  /**
   * Signed delta. String form requires `unit` (or product.baseUnit is loaded).
   * Decimal form is re-validated against product.baseUnit under D07.
   */
  delta: Decimal | string;
  unit?: BaseUnit;
  actorSub: string;
  correlationId: string;
  /** Test seam for the expiry check; defaults to the current instant. */
  now?: Date;
  /** Override org timezone for expiry; otherwise loaded from organization singleton. */
  timezone?: string;
};

export type AdjustStockResult = {
  movement: StockMovementRecord;
  /** True when a movement for (sourceLineId, kind) already existed and nothing was written. */
  replayed: boolean;
};

export type OpenStockBalanceInput = Omit<AdjustStockInput, "kind" | "delta"> & {
  /** Positive opening quantity. */
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
    existing.delta.eq(delta) &&
    existing.actorSub === input.actorSub
  );
}

/**
 * Deterministic lock order for callers touching several balances in one tx:
 * always read (warehouseId ASC, batchId ASC) before any write.
 */
export async function findBalancesOrdered(tx: Tx, keys: readonly BalanceKey[]) {
  if (keys.length === 0) return [];
  return tx.stockBalance.findMany({
    where: { OR: keys.map((k) => ({ warehouseId: k.warehouseId, batchId: k.batchId })) },
    orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }],
  });
}

/**
 * Apply one signed stock delta and append the movement, inside the caller's transaction.
 * Idempotent on (sourceLineId, kind) when payload matches; balance never goes negative.
 */
export async function adjustStock(tx: Tx, input: AdjustStockInput): Promise<AdjustStockResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { baseUnit: true, status: true },
  });
  if (!product) throw new DomainError("PRODUCT_NOT_FOUND", 404);
  if (product.status !== "active" && input.kind !== "issue") {
    // Allow issue from archived product stock; block new receipts onto archived SKUs.
    throw new DomainError("PRODUCT_ARCHIVED", 409);
  }
  const unit = (input.unit ?? product.baseUnit) as BaseUnit;
  if (unit !== product.baseUnit) throw new DomainError("QUANTITY_UNIT_MISMATCH", 422);

  const delta =
    typeof input.delta === "string"
      ? parseQuantity(input.delta, unit)
      : parseQuantity(input.delta.toFixed(), unit);
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
    select: { productId: true, qualityStatus: true, expiresOn: true },
  });
  if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);
  if (batch.productId !== input.productId) {
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
    addQuantity(current, delta); // overflow guard before write
    if (!balance) {
      await tx.stockBalance.createMany({
        data: [{ ...key, productId: input.productId, quantity: new Decimal(0) }],
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

/** Opening balance = a positive `receipt` movement through the same ledger path. */
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

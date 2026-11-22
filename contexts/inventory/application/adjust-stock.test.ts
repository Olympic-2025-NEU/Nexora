// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";
import { adjustStock, openStockBalance } from "./adjust-stock";
import { todayInTimezone } from "./warehouse-scope";

function mockTx(state: {
  warehouseStatus?: string;
  batch?: { productId: string; qualityStatus: string; expiresOn: Date | null };
  balanceQty?: Decimal | null;
  existingMovement?: {
    warehouseId: string;
    batchId: string;
    productId: string;
    delta: Decimal;
    actorSub: string;
  } | null;
  productStatus?: string;
  baseUnit?: string;
  timezone?: string;
}) {
  let qty = state.balanceQty === undefined ? null : state.balanceQty;
  return {
    product: {
      async findUnique() {
        return { baseUnit: state.baseUnit ?? "EA", status: state.productStatus ?? "active" };
      },
    },
    organization: {
      async findUnique() {
        return { timezone: state.timezone ?? "Asia/Ho_Chi_Minh" };
      },
    },
    stockMovement: {
      async findUnique() {
        if (!state.existingMovement) return null;
        return {
          id: "m1",
          createdAt: new Date(),
          warehouseId: state.existingMovement.warehouseId,
          batchId: state.existingMovement.batchId,
          productId: state.existingMovement.productId,
          sourceLineId: "s",
          kind: "receipt",
          delta: state.existingMovement.delta,
          balanceAfter: new Decimal(1),
          actorSub: state.existingMovement.actorSub,
          reversalOf: null,
        };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        return { ...data, createdAt: new Date(), reversalOf: null };
      },
    },
    warehouse: {
      async findUnique() {
        return state.warehouseStatus ? { status: state.warehouseStatus } : null;
      },
    },
    batch: {
      async findUnique() {
        return state.batch ?? null;
      },
    },
    stockBalance: {
      async findUnique() {
        return qty == null ? null : { quantity: qty, version: 1 };
      },
      async findUniqueOrThrow() {
        return { quantity: qty ?? new Decimal(0) };
      },
      async createMany() {
        if (qty == null) qty = new Decimal(0);
        return { count: 1 };
      },
      async updateMany({ data }: { data: { quantity?: { increment?: Decimal; decrement?: Decimal } } }) {
        if (qty == null) return { count: 0 };
        if (data.quantity?.decrement) {
          if (qty.lt(data.quantity.decrement)) return { count: 0 };
          qty = qty.sub(data.quantity.decrement);
          return { count: 1 };
        }
        if (data.quantity?.increment) {
          qty = qty.add(data.quantity.increment);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    getQty: () => qty,
  };
}

test("todayInTimezone uses org zone not raw UTC for early local morning", () => {
  // 2026-11-22 01:00 UTC = 08:00 Asia/Ho_Chi_Minh same calendar day
  const utcMorning = new Date("2026-11-21T20:00:00.000Z"); // 03:00 ICT next calendar day? 
  // 20:00 UTC Nov 21 = 03:00 ICT Nov 22
  assert.equal(todayInTimezone("Asia/Ho_Chi_Minh", utcMorning), "2026-11-22");
  assert.equal(todayInTimezone("UTC", utcMorning), "2026-11-21");
});

test("openStockBalance writes receipt and replays idempotently", async () => {
  const tx = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "available", expiresOn: null },
    balanceQty: null,
  });
  const first = await openStockBalance(tx as never, {
    warehouseId: "w",
    batchId: "b",
    productId: "p",
    sourceLineId: "s",
    quantity: "10",
    unit: "EA",
    actorSub: "actor",
    correlationId: "c1",
  });
  assert.equal(first.replayed, false);
  assert.equal(tx.getQty()?.toString(), "10");

  const tx2 = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "available", expiresOn: null },
    existingMovement: {
      warehouseId: "w",
      batchId: "b",
      productId: "p",
      delta: new Decimal(10),
      actorSub: "actor",
    },
  });
  const second = await openStockBalance(tx2 as never, {
    warehouseId: "w",
    batchId: "b",
    productId: "p",
    sourceLineId: "s",
    quantity: "10",
    unit: "EA",
    actorSub: "actor",
    correlationId: "c1",
  });
  assert.equal(second.replayed, true);
});

test("replay with different delta is conflict", async () => {
  const tx = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "available", expiresOn: null },
    existingMovement: {
      warehouseId: "w",
      batchId: "b",
      productId: "p",
      delta: new Decimal(10),
      actorSub: "actor",
    },
  });
  await assert.rejects(
    () =>
      openStockBalance(tx as never, {
        warehouseId: "w",
        batchId: "b",
        productId: "p",
        sourceLineId: "s",
        quantity: "5",
        unit: "EA",
        actorSub: "actor",
        correlationId: "c1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "STOCK_MOVEMENT_CONFLICT",
  );
});

test("issue blocked for inspect and insufficient stock; EA fraction rejected", async () => {
  const blocked = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "inspect", expiresOn: null },
    balanceQty: new Decimal(5),
  });
  await assert.rejects(
    () =>
      adjustStock(blocked as never, {
        warehouseId: "w",
        batchId: "b",
        productId: "p",
        sourceLineId: "s1",
        kind: "issue",
        delta: "-1",
        unit: "EA",
        actorSub: "a",
        correlationId: "c",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "BATCH_QUALITY_BLOCKED",
  );

  const short = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "available", expiresOn: null },
    balanceQty: new Decimal(1),
  });
  await assert.rejects(
    () =>
      adjustStock(short as never, {
        warehouseId: "w",
        batchId: "b",
        productId: "p",
        sourceLineId: "s2",
        kind: "issue",
        delta: "-5",
        unit: "EA",
        actorSub: "a",
        correlationId: "c",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_STOCK",
  );

  const frac = mockTx({
    warehouseStatus: "active",
    batch: { productId: "p", qualityStatus: "available", expiresOn: null },
    balanceQty: new Decimal(5),
    baseUnit: "EA",
  });
  await assert.rejects(
    () =>
      adjustStock(frac as never, {
        warehouseId: "w",
        batchId: "b",
        productId: "p",
        sourceLineId: "s3",
        kind: "issue",
        delta: new Decimal("1.5"),
        unit: "EA",
        actorSub: "a",
        correlationId: "c",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "QUANTITY_EA_FRACTION",
  );
});

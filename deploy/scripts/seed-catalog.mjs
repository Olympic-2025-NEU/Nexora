// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Idempotent catalog/inventory seed (create-if-missing only — does not reset operator state).
 * Opening stock writes a receipt movement (same ledger shape as openStockBalance) — never
 * UPDATE balance as the source of truth without a movement.
 *
 * Env: DATABASE_URL, INSTANCE_ID
 * Optional: SEED_OPENING_QTY (default "100", EA integral), SEED_PRODUCT_SKU (default DEMO-SKU-A)
 * Optional: SEED_STAFF_SUBS=comma-separated keycloak subs to grant WH-A (default: none)
 */
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};

if (process.env.NODE_ENV === "production") {
  console.error("seed-catalog refused in production");
  process.exit(1);
}

const instanceId = required("INSTANCE_ID");
const sku = process.env.SEED_PRODUCT_SKU || "DEMO-SKU-A";
const openingQty = process.env.SEED_OPENING_QTY || "100";
if (!/^(0|[1-9]\d*)$/.test(openingQty) || openingQty === "0") {
  throw new Error("SEED_OPENING_QTY must be a positive integer (EA)");
}
const prisma = new PrismaClient();

function stableUuid(label) {
  const hex = createHash("sha256").update(`${instanceId}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  const membership = await prisma.membership.findFirst({
    where: { status: "active", role: "administrator" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new Error("No active administrator membership; run seed-system first");

  const productId = stableUuid("product");
  const batchId = stableUuid("batch");
  const warehouseId = stableUuid("warehouse");
  const sourceLineId = stableUuid("opening-line");

  if (!(await prisma.product.findUnique({ where: { sku } }))) {
    await prisma.product.create({
      data: {
        id: productId,
        sku,
        name: "Demo Product A",
        description: "P06 seed product",
        baseUnit: "EA",
        status: "active",
        createdBySub: membership.keycloakSub,
      },
    });
  }
  const product = await prisma.product.findUniqueOrThrow({ where: { sku } });

  let warehouse = await prisma.warehouse.findUnique({ where: { code: "WH-A" } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        id: warehouseId,
        code: "WH-A",
        name: "Main warehouse A",
        status: "active",
        createdBySub: membership.keycloakSub,
      },
    });
  }

  let batch = await prisma.batch.findUnique({
    where: {
      originIssuerInstanceId_originLotId: {
        originIssuerInstanceId: instanceId,
        originLotId: batchId,
      },
    },
  });
  if (!batch) {
    batch = await prisma.batch.create({
      data: {
        id: batchId,
        productId: product.id,
        localCode: "LOT-A-001",
        originIssuerInstanceId: instanceId,
        originLotId: batchId,
        qualityStatus: "available",
        createdBySub: membership.keycloakSub,
      },
    });
  }

  const existingMove = await prisma.stockMovement.findUnique({
    where: { sourceLineId_kind: { sourceLineId, kind: "receipt" } },
  });
  let opening = "replayed";
  if (!existingMove) {
    const qty = new Prisma.Decimal(openingQty);
    await prisma.$transaction(async (tx) => {
      await tx.stockBalance.createMany({
        data: [
          {
            warehouseId: warehouse.id,
            batchId: batch.id,
            productId: product.id,
            quantity: new Prisma.Decimal(0),
          },
        ],
        skipDuplicates: true,
      });
      const updated = await tx.stockBalance.updateMany({
        where: { warehouseId: warehouse.id, batchId: batch.id },
        data: { quantity: { increment: qty }, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("opening balance update failed");
      const after = await tx.stockBalance.findUniqueOrThrow({
        where: { warehouseId_batchId: { warehouseId: warehouse.id, batchId: batch.id } },
      });
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          warehouseId: warehouse.id,
          batchId: batch.id,
          productId: product.id,
          sourceLineId,
          kind: "receipt",
          delta: qty,
          balanceAfter: after.quantity,
          actorSub: membership.keycloakSub,
          correlationId: `seed-opening:${instanceId}`,
        },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorSub: membership.keycloakSub,
          action: "inventory.open_balance",
          targetType: "stock_balance",
          targetId: `${warehouse.id}:${batch.id}`,
          outcome: "success",
          requestId: randomUUID(),
          afterSummary: { kind: "receipt", count: Number(openingQty) },
        },
      });
    });
    opening = "created";
  }

  const staffSubs = (process.env.SEED_STAFF_SUBS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let staffScoped = 0;
  for (const sub of staffSubs) {
    const m = await prisma.membership.findUnique({ where: { keycloakSub: sub } });
    if (!m || m.role === "administrator") continue;
    await prisma.membershipWarehouse.upsert({
      where: {
        membershipId_warehouseId: { membershipId: m.id, warehouseId: warehouse.id },
      },
      create: { membershipId: m.id, warehouseId: warehouse.id },
      update: {},
    });
    staffScoped += 1;
  }

  console.log(
    JSON.stringify({
      ok: true,
      productId: product.id,
      batchId: batch.id,
      warehouseId: warehouse.id,
      opening,
      staffScoped,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

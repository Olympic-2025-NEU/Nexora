// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Idempotent catalog/inventory seed (create-if-missing).
 * P065: product + primary variant (sku) + CÁI stock UOM + default price list item.
 *
 * Env: DATABASE_URL, INSTANCE_ID
 * Optional: SEED_OPENING_QTY, SEED_PRODUCT_SKU, SEED_STAFF_SUBS
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
if (!/^(0|[1-9]\d*)$/.test(openingQty) ||
    (openingQty === "0" && process.env.DEMO_ONLY !== "true")) {
  throw new Error("SEED_OPENING_QTY must be positive, or zero only for DEMO_ONLY");
}
const prisma = new PrismaClient();

const UOM_CAI = "aaaaaaaa-0001-4000-8000-000000000001";
const CAT_UNCATEGORIZED = "bbbbbbbb-0001-4000-8000-000000000001";
const PRICE_LIST_DEFAULT = "cccccccc-0001-4000-8000-000000000001";

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
  const variantId = stableUuid("variant");
  const batchId = stableUuid("batch");
  const warehouseId = stableUuid("warehouse");
  const sourceLineId = stableUuid("opening-line");

  let product = await prisma.product.findFirst({
    where: { variants: { some: { sku } } },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        id: productId,
        name: `Demo Product ${instanceId.toUpperCase()}`,
        searchText: `demo product ${instanceId}`,
        attributes: { description: "P065 seed product" },
        categoryId: CAT_UNCATEGORIZED,
        isActive: true,
        createdBySub: membership.keycloakSub,
      },
    });
  }

  let variant = await prisma.productVariant.findFirst({ where: { sku } });
  if (!variant) {
    variant = await prisma.productVariant.create({
      data: {
        id: variantId,
        productId: product.id,
        sku,
        barcode: sku,
        isPrimary: true,
        isActive: true,
        createdBySub: membership.keycloakSub,
      },
    });
    await prisma.variantCode.create({
      data: { code: sku.toUpperCase(), variantId: variant.id, source: "both" },
    });
    await prisma.productVariantUom.create({
      data: {
        id: stableUuid("variant-uom"),
        productVariantId: variant.id,
        uomId: UOM_CAI,
        isStockKeeping: true,
        factorToStockUom: new Prisma.Decimal(1),
      },
    });
  }

  const priceItem = await prisma.priceListItem.findFirst({
    where: {
      priceListId: PRICE_LIST_DEFAULT,
      productVariantId: variant.id,
      uomId: UOM_CAI,
      priceType: "retail",
    },
  });
  if (!priceItem) {
    await prisma.priceListItem.create({
      data: {
        id: stableUuid("price-item"),
        priceListId: PRICE_LIST_DEFAULT,
        productVariantId: variant.id,
        uomId: UOM_CAI,
        priceType: "retail",
        amount: new Prisma.Decimal("10000"),
      },
    });
  }

  const warehouseCode = `WH-${instanceId.toUpperCase()}`;
  let warehouse = await prisma.warehouse.findUnique({ where: { code: warehouseCode } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        id: warehouseId,
        code: warehouseCode,
        name: `Main warehouse ${instanceId.toUpperCase()}`,
        status: "active",
        createdBySub: membership.keycloakSub,
      },
    });
  }

  let batch = await prisma.batch.findUnique({
    where: {
      originIssuerInstanceId_originLotId: {
        originIssuerInstanceId: process.env.SEED_ORIGIN_ISSUER_INSTANCE_ID || instanceId,
        originLotId: process.env.SEED_ORIGIN_LOT_ID || batchId,
      },
    },
  });
  if (!batch) {
    batch = await prisma.batch.create({
      data: {
        id: batchId,
        productId: product.id,
        productVariantId: variant.id,
        localCode: `LOT-${instanceId.toUpperCase()}-001`,
        originIssuerInstanceId: process.env.SEED_ORIGIN_ISSUER_INSTANCE_ID || instanceId,
        originLotId: process.env.SEED_ORIGIN_LOT_ID || batchId,
        qualityStatus: process.env.DEMO_ONLY === "true" ? "inspect" : "available",
        createdBySub: membership.keycloakSub,
      },
    });
  }

  const existingMove = await prisma.stockMovement.findUnique({
    where: { sourceLineId_kind: { sourceLineId, kind: "receipt" } },
  });
  let opening = "replayed";
  if (!existingMove && openingQty !== "0") {
    const qty = new Prisma.Decimal(openingQty);
    await prisma.$transaction(async (tx) => {
      await tx.stockBalance.createMany({
        data: [
          {
            warehouseId: warehouse.id,
            batchId: batch.id,
            productId: product.id,
            productVariantId: variant.id,
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
          productVariantId: variant.id,
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
  } else if (openingQty === "0") {
    opening = "zero";
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
      variantId: variant.id,
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

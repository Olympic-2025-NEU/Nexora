// SPDX-License-Identifier: AGPL-3.0-only
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { DomainError } from "@/platform/kernel/errors";

export type FefoLot = {
  batchId: string;
  productVariantId: string;
  warehouseId: string;
  quantity: string;
  expiresOn: string | null;
  localCode: string;
};

/**
 * Allocate quantity across available non-expired balances (FEFO: earliest expires_on first; nulls last).
 */
export async function allocateFefo(
  tx: Prisma.TransactionClient,
  input: {
    warehouseId: string;
    productVariantId: string;
    quantity: string;
    timezone: string;
  },
): Promise<FefoLot[]> {
  const need = new Decimal(input.quantity);
  if (need.lte(0)) throw new DomainError("QUANTITY_INVALID", 422);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const balances = await tx.stockBalance.findMany({
    where: {
      warehouseId: input.warehouseId,
      productVariantId: input.productVariantId,
      quantity: { gt: 0 },
      batch: { qualityStatus: "available" },
    },
    include: {
      batch: { select: { id: true, productVariantId: true, expiresOn: true, localCode: true, qualityStatus: true } },
    },
  });

  const eligible = balances
    .filter((row) => {
      if (!row.batch || row.batch.qualityStatus !== "available") return false;
      if (!row.batch.expiresOn) return true;
      return row.batch.expiresOn.toISOString().slice(0, 10) >= today;
    })
    .sort((a, b) => {
      const ae = a.batch.expiresOn?.toISOString().slice(0, 10) ?? "9999-12-31";
      const be = b.batch.expiresOn?.toISOString().slice(0, 10) ?? "9999-12-31";
      if (ae !== be) return ae < be ? -1 : 1;
      return a.batchId < b.batchId ? -1 : 1;
    });

  const lots: FefoLot[] = [];
  let remaining = need;
  for (const row of eligible) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(row.quantity, remaining);
    if (take.lte(0)) continue;
    lots.push({
      batchId: row.batchId,
      productVariantId: row.batch.productVariantId,
      warehouseId: row.warehouseId,
      quantity: take.toFixed(3),
      expiresOn: row.batch.expiresOn?.toISOString().slice(0, 10) ?? null,
      localCode: row.batch.localCode,
    });
    remaining = remaining.minus(take);
  }

  if (remaining.gt(0)) {
    throw new DomainError("INSUFFICIENT_STOCK", 422);
  }
  return lots;
}

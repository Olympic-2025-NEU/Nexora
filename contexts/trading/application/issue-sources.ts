// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { DomainError } from "../../../platform/kernel/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listIssueSources(db: PrismaClient, actor: Actor,
  batchId: string, warehouseId: string, cursor?: string, limit = 20) {
  if (!checkPolicy(actor, "trading:issue:read").allowed)
    throw new DomainError("POLICY_DENIED", 403);
  if (!UUID.test(batchId) || !UUID.test(warehouseId) || (cursor && !UUID.test(cursor)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new DomainError("ISSUE_SOURCE_QUERY_INVALID", 422);
  if (!actor.roles.includes("administrator") && !actor.unitIds.includes(warehouseId))
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  const rows = await db.documentLine.findMany({ where: { batchId, warehouseId,
    document: { status: "confirmed", documentType: { in: ["goods_receipt", "receiving_confirmation"] } } },
    include: { document: { select: { documentNumber: true, documentType: true,
      confirmedAt: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  const page = rows.slice(0, limit);
  const used = page.length ? await db.issueSourceAllocation.groupBy({ by: ["sourceLineId"],
    where: { sourceLineId: { in: page.map((row) => row.id) },
      issueLine: { document: { status: "confirmed" } } }, _sum: { quantity: true } }) : [];
  const bySource = new Map(used.map((row) => [row.sourceLineId, row._sum.quantity ?? new Decimal(0)]));
  return { items: page.map((row) => {
    const received = row.document.documentType === "receiving_confirmation"
      ? row.actualQuantity : row.quantity;
    const remaining = (received ?? new Decimal(0)).minus(bySource.get(row.id) ?? new Decimal(0));
    return { sourceLineId: row.id, documentNumber: row.document.documentNumber,
      documentType: row.document.documentType,
      confirmedAt: row.document.confirmedAt?.toISOString() ?? null,
      receivedQuantity: (received ?? new Decimal(0)).toFixed(3),
      availableQuantity: Decimal.max(0, remaining).toFixed(3), uomId: row.uomId };
  }).filter((row) => row.availableQuantity !== "0.000"),
  nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}

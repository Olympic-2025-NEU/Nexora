// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";

type Source = { id: string; documentId: string | null; batchId: string | null;
  issuerInstanceId?: string; externalEventId?: string };

/** A cached grant may arrive after an immutable transfer event was projected. */
export async function traceSummaryRefreshes(db: PrismaClient, rows: Source[]) {
  const keys = rows.flatMap((row) => row.issuerInstanceId && row.externalEventId
    ? [{ issuerInstanceId: row.issuerInstanceId, externalEventId: row.externalEventId }] : []);
  if (!keys.length) return new Map<string, string>();
  const grants = await db.federatedTraceSummary.findMany({ where: { OR: keys,
    state: "active" }, select: { issuerInstanceId: true, externalEventId: true,
      refreshedAt: true } });
  return new Map(grants.map((grant) => [
    `${grant.issuerInstanceId}:${grant.externalEventId}`,
    grant.refreshedAt.toISOString(),
  ]));
}

export async function visibleTraceEventIds(db: PrismaClient, actor: Actor, rows: Source[]) {
  const batchIds = [...new Set(rows.flatMap((row) => row.batchId ? [row.batchId] : []))];
  const revoked = batchIds.length ? await db.federatedTraceSummary.findMany({ where: {
    batchId: { in: batchIds }, state: "revoked" },
    select: { issuerInstanceId: true, externalEventId: true } }) : [];
  const blocked = new Set(revoked.map((row) => `${row.issuerInstanceId}:${row.externalEventId}`));
  const active = rows.filter((row) => !blocked.has(`${row.issuerInstanceId}:${row.externalEventId}`));
  if (actor.roles.some((role) => role.toLowerCase() === "administrator"))
    return new Set(active.map((row) => row.id));
  const warehouseIds = [...actor.unitIds];
  if (!warehouseIds.length) return new Set<string>();
  const documentIds = active.flatMap((row) => row.documentId ? [row.documentId] : []);
  const lines = await db.documentLine.findMany({ where: { warehouseId: { in: warehouseIds },
    OR: [{ documentId: { in: documentIds } }, { batchId: { in: batchIds } }] },
    select: { documentId: true, batchId: true } });
  const allowed = new Set(lines.map((line) => `${line.documentId}:${line.batchId}`));
  const allowedBatch = new Set(lines.map((line) => line.batchId));
  return new Set(active.filter((row) => row.batchId &&
    (row.documentId ? allowed.has(`${row.documentId}:${row.batchId}`)
      : allowedBatch.has(row.batchId))).map((row) => row.id));
}

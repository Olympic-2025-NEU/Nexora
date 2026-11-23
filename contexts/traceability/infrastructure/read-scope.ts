// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";

type Source = { id: string; documentId: string | null; batchId: string | null };

export async function visibleTraceEventIds(db: PrismaClient, actor: Actor, rows: Source[]) {
  if (actor.roles.some((role) => role.toLowerCase() === "administrator"))
    return new Set(rows.map((row) => row.id));
  const warehouseIds = [...actor.unitIds];
  if (!warehouseIds.length) return new Set<string>();
  const documentIds = rows.flatMap((row) => row.documentId ? [row.documentId] : []);
  if (!documentIds.length) return new Set<string>();
  const lines = await db.documentLine.findMany({ where: { documentId: { in: documentIds },
    warehouseId: { in: warehouseIds } }, select: { documentId: true, batchId: true } });
  const allowed = new Set(lines.map((line) => `${line.documentId}:${line.batchId}`));
  return new Set(rows.filter((row) => row.documentId && row.batchId &&
    allowed.has(`${row.documentId}:${row.batchId}`)).map((row) => row.id));
}

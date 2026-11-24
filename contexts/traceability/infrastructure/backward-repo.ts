// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { BACKWARD_MAX_NODES, type BackwardEvent, type BackwardPort } from "../application/backward";
import { traceLag } from "./lag";
import { visibleTraceEventIds } from "./read-scope";

function projection(row: {
  id: string; issuerInstanceId: string; batchId: string | null;
  originIssuerInstanceId: string; originLotId: string; eventType: string;
  documentId: string | null; externalEventId: string; payloadVersion: string;
  summary: unknown; occurredAt: Date; createdAt: Date; verificationState: string;
  outgoing: { toEventId: string | null; missingRef: unknown; relation: string;
    verificationState: string; allocationDetail: unknown }[];
}): BackwardEvent {
  return { ...row, outgoing: row.outgoing.map((link) => ({
    toEventId: link.toEventId,
    missingRef: link.missingRef as { issuerInstanceId: string; eventId: string } | null,
    relation: link.relation, verificationState: link.verificationState,
    ...(Array.isArray(link.allocationDetail) ? { allocationDetail: link.allocationDetail as
      { issueLineId: string; sourceLineId: string; quantity: string }[] } : {}),
  })) };
}

export function createPrismaBackwardPort(db: PrismaClient, actor: Actor): BackwardPort {
  async function scoped<T extends Parameters<typeof projection>[0]>(rows: T[]) {
    const allowed = await visibleTraceEventIds(db, actor, rows);
    const visible = rows.filter((row) => allowed.has(row.id));
    if (actor.roles.some((role) => role.toLowerCase() === "administrator") || !visible.length)
      return visible.map(projection);
    const targetIds = [...new Set(visible.flatMap((row) =>
      row.outgoing.flatMap((link) => link.toEventId ? [link.toEventId] : [])))];
    const targets = await db.traceEvent.findMany({ where: { id: { in: targetIds } },
      select: { id: true, documentId: true, batchId: true } });
    const allowedTargets = await visibleTraceEventIds(db, actor, targets);
    return visible.map((row) => projection({ ...row, outgoing: row.outgoing.filter((link) =>
      !link.toEventId || allowedTargets.has(link.toEventId)) }));
  }
  return {
    async batchExists(batchId) {
      return Boolean(await db.batch.findUnique({ where: { id: batchId }, select: { id: true } }));
    },
    async roots(batchId, documentId, asOf) {
      const rows = await db.traceEvent.findMany({ where: { batchId,
        createdAt: { lte: asOf }, ...(documentId ? { documentId } : {}) },
        include: { outgoing: { where: { createdAt: { lte: asOf } },
          orderBy: { id: "asc" } } }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        take: BACKWARD_MAX_NODES + 1 });
      return scoped(rows);
    },
    async event(id, asOf) {
      const row = await db.traceEvent.findFirst({ where: { id, createdAt: { lte: asOf } },
        include: { outgoing: { where: { createdAt: { lte: asOf } },
          orderBy: { id: "asc" } } } });
      return row ? (await scoped([row]))[0] ?? null : null;
    },
    pending: () => traceLag(db),
  };
}

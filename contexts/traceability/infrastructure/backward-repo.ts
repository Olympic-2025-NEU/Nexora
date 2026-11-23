// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { BACKWARD_MAX_NODES, type BackwardEvent, type BackwardPort } from "../application/backward";
import { traceLag } from "./lag";

function projection(row: {
  id: string; issuerInstanceId: string; batchId: string | null;
  originIssuerInstanceId: string; originLotId: string; eventType: string;
  documentId: string | null; externalEventId: string; payloadVersion: string;
  summary: unknown; occurredAt: Date; createdAt: Date; verificationState: string;
  outgoing: { toEventId: string | null; missingRef: unknown; relation: string;
    verificationState: string }[];
}): BackwardEvent {
  return { ...row, outgoing: row.outgoing.map((link) => ({
    toEventId: link.toEventId,
    missingRef: link.missingRef as { issuerInstanceId: string; eventId: string } | null,
    relation: link.relation, verificationState: link.verificationState,
  })) };
}

export function createPrismaBackwardPort(db: PrismaClient): BackwardPort {
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
      return rows.map(projection);
    },
    async event(id, asOf) {
      const row = await db.traceEvent.findFirst({ where: { id, createdAt: { lte: asOf } },
        include: { outgoing: { where: { createdAt: { lte: asOf } },
          orderBy: { id: "asc" } } } });
      return row ? projection(row) : null;
    },
    pending: () => traceLag(db),
  };
}

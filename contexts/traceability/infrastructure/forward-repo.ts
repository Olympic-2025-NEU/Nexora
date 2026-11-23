// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { BACKWARD_MAX_NODES } from "../application/backward";
import type { ForwardEvent, ForwardPort, ImpactLine } from "../application/forward";
import { traceLag } from "./lag";
import { visibleTraceEventIds } from "./read-scope";

const kinds: Record<string, ImpactLine["kind"]> = {
  "trading.issue.confirmed.v1": "issue",
  "trading.transfer.confirmed.v1": "transfer",
  "trading.receiving.confirmed.v1": "receiving",
  "trading.sale.recorded.v1": "sale",
};
type Row = { id: string; issuerInstanceId: string; batchId: string | null;
  originIssuerInstanceId: string; originLotId: string; eventType: string;
  documentId: string | null; externalEventId: string; payloadVersion: string;
  summary: unknown; occurredAt: Date; createdAt: Date; verificationState: string;
  incoming: { fromEventId: string; relation: string; verificationState: string }[] };

export function createPrismaForwardPort(db: PrismaClient, actor: Actor): ForwardPort {
  const allWarehouses = actor.roles.some((role) => role.toLowerCase() === "administrator");
  const warehouseIds = [...actor.unitIds];
  async function scoped(rows: Row[]): Promise<ForwardEvent[]> {
    const rootIds = await visibleTraceEventIds(db, actor, rows);
    const visibleRows = rows.filter((row) => rootIds.has(row.id));
    if (allWarehouses || !visibleRows.length) return visibleRows;
    const childIds = [...new Set(visibleRows.flatMap((row) =>
      row.incoming.map((link) => link.fromEventId)))];
    const children = await db.traceEvent.findMany({ where: { id: { in: childIds } },
      select: { id: true, documentId: true, batchId: true } });
    const allowedChildren = await visibleTraceEventIds(db, actor, children);
    return visibleRows.map((row) => ({ ...row, incoming: row.incoming.filter((link) =>
      allowedChildren.has(link.fromEventId)) }));
  }
  const withIncoming = (asOf: Date) => ({ incoming: { where: { createdAt: { lte: asOf } },
    orderBy: { id: "asc" as const } } });
  return {
    async batchExists(batchId) {
      return Boolean(await db.batch.findUnique({ where: { id: batchId }, select: { id: true } }));
    },
    async roots(batchId, asOf) {
      const rows = await db.traceEvent.findMany({ where: { batchId, createdAt: { lte: asOf } },
        include: withIncoming(asOf), orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: BACKWARD_MAX_NODES + 1 });
      return scoped(rows);
    },
    async event(id, asOf) {
      const row = await db.traceEvent.findFirst({ where: { id, createdAt: { lte: asOf } },
        include: withIncoming(asOf) });
      return row ? (await scoped([row]))[0] ?? null : null;
    },
    async impact(events) {
      const documentIds = [...new Set(events.flatMap((event) => event.documentId ? [event.documentId] : []))];
      if (!documentIds.length) return [];
      const documents = await db.document.findMany({ where: { id: { in: documentIds }, status: "confirmed" },
        include: { lines: { include: { uom: { select: { code: true } } },
          orderBy: { lineNo: "asc" } }, transferDetail: {
          include: { destinationPartner: { select: { id: true, issuerInstanceId: true } } } },
          receivingDetail: true } });
      const byId = new Map(documents.map((document) => [document.id, document]));
      const result: ImpactLine[] = [];
      const seen = new Set<string>();
      for (const event of events) {
        const kind = kinds[event.eventType];
        const document = event.documentId ? byId.get(event.documentId) : undefined;
        if (!kind || !document || !event.batchId || event.verificationState === "missing") continue;
        for (const line of document.lines) {
          if (line.batchId !== event.batchId || (!allWarehouses && !warehouseIds.includes(line.warehouseId)))
            continue;
          const key = `${event.issuerInstanceId}:${event.externalEventId}:${line.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const actual = line.actualQuantity?.toString();
          const sent = line.quantity?.toString();
          const quantity = kind === "receiving" ? actual : sent;
          if (quantity === undefined) continue;
          const partner = kind === "transfer" ? document.transferDetail?.destinationPartner
            : kind === "receiving" && document.receivingDetail
              ? { issuerInstanceId: document.receivingDetail.sourceIssuerInstanceId } : undefined;
          result.push({ eventId: event.id, sourceDocumentId: document.id, sourceLineId: line.id,
            kind, quantity, uomId: line.uomId, uomCode: line.uom.code,
            verificationState: event.verificationState === "partner_asserted"
              ? "partner_asserted" : "confirmed",
            ...(line.sourceIssueLineId ? { sourceIssueLineId: line.sourceIssueLineId } : {}),
            ...(kind === "receiving" ? { sentQuantity: sent ?? "0", actualQuantity: actual ?? "0" } : {}),
            ...(partner ? { partner } : {}) });
        }
      }
      return result;
    },
    pending: () => traceLag(db),
  };
}

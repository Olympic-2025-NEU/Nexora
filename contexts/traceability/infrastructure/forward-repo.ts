// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { BACKWARD_MAX_NODES } from "../application/backward";
import type { ForwardEvent, ForwardPort, ImpactLine } from "../application/forward";
import { traceLag } from "./lag";
import { traceSummaryRefreshes, visibleTraceEventIds } from "./read-scope";

const kinds: Record<string, ImpactLine["kind"]> = {
  "trading.issue.confirmed.v1": "issue",
  "trading.transfer.confirmed.v1": "transfer",
  "trading.receiving.confirmed.v1": "receiving",
  "trading.sale.recorded.v1": "sale",
};
const federationUnitKinds: Record<string, string> = { EA: "count", KG: "mass", L: "volume" };
type Row = { id: string; issuerInstanceId: string; batchId: string | null;
  originIssuerInstanceId: string; originLotId: string; eventType: string;
  documentId: string | null; externalEventId: string; payloadVersion: string;
  summary: unknown; occurredAt: Date; createdAt: Date; verificationState: string;
  incoming: { fromEventId: string; relation: string; verificationState: string;
    allocationDetail: unknown }[] };

export function createPrismaForwardPort(db: PrismaClient, actor: Actor): ForwardPort {
  const allWarehouses = actor.roles.some((role) => role.toLowerCase() === "administrator");
  const warehouseIds = [...actor.unitIds];
  async function scoped(rows: Row[]): Promise<ForwardEvent[]> {
    const rootIds = await visibleTraceEventIds(db, actor, rows);
    const visibleRows = rows.filter((row) => rootIds.has(row.id));
    if (!visibleRows.length) return visibleRows.map((row) => ({ ...row,
      incoming: row.incoming.map((link) => ({ ...link,
        allocationDetail: Array.isArray(link.allocationDetail)
          ? link.allocationDetail : undefined })) })) as ForwardEvent[];
    const refreshes = await traceSummaryRefreshes(db, visibleRows);
    const childIds = [...new Set(visibleRows.flatMap((row) =>
      row.incoming.map((link) => link.fromEventId)))];
    const children = await db.traceEvent.findMany({ where: { id: { in: childIds } },
      select: { id: true, documentId: true, batchId: true,
        issuerInstanceId: true, externalEventId: true } });
    const allowedChildren = await visibleTraceEventIds(db, actor, children);
    return visibleRows.map((row) => ({ ...row,
      summary: refreshes.has(`${row.issuerInstanceId}:${row.externalEventId}`)
        ? { ...(row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
          ? row.summary : {}), observedAt: refreshes.get(`${row.issuerInstanceId}:${row.externalEventId}`) }
        : row.summary,
      incoming: row.incoming.filter((link) =>
      allowedChildren.has(link.fromEventId)).map((link) => ({ ...link,
        allocationDetail: Array.isArray(link.allocationDetail)
          ? link.allocationDetail : undefined })) })) as ForwardEvent[];
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
      const remoteBatchIds = [...new Set(events.flatMap((event) =>
        event.eventType === "downstream.impact.v1" && !event.documentId && event.batchId
          ? [event.batchId] : []))];
      const remoteBatches = await db.batch.findMany({ where: { id: { in: remoteBatchIds } },
        select: { id: true, productVariantId: true } });
      const variantIds = [...new Set(remoteBatches.map((batch) => batch.productVariantId))];
      const stockUnits = await db.productVariantUom.findMany({ where: {
        productVariantId: { in: variantIds }, isStockKeeping: true,
        factorToStockUom: 1 }, include: { uom: { select: { id: true, kind: true } } } });
      const byVariantKind = new Map(stockUnits.map((entry) =>
        [`${entry.productVariantId}:${entry.uom.kind}`, entry.uom.id]));
      const localUnitByBatchKind = new Map(remoteBatches.flatMap((batch) =>
        ["count", "mass", "volume"].flatMap((kind) => {
          const id = byVariantKind.get(`${batch.productVariantId}:${kind}`);
          return id ? [[`${batch.id}:${kind}`, id] as const] : [];
        })));
      const documents = await db.document.findMany({ where: { id: { in: documentIds }, status: "confirmed" },
        include: { lines: { include: { uom: { select: { code: true } } },
          orderBy: { lineNo: "asc" } }, transferDetail: {
          include: { destinationPartner: { select: { id: true, issuerInstanceId: true } } } },
          receivingDetail: true } });
      const byId = new Map(documents.map((document) => [document.id, document]));
      const result: ImpactLine[] = [];
      const seen = new Set<string>();
      for (const event of events) {
        if (event.eventType === "downstream.impact.v1" && !event.documentId &&
            event.verificationState === "partner_asserted") {
          const safe = event.summary as { quantity?: string; unit?: string;
            sourceLineId?: string; sourceDocument?: { id?: string };
            downstreamPartnerRef?: string } | null;
          if (safe?.quantity && safe.unit && safe.sourceLineId && safe.sourceDocument?.id &&
              safe.downstreamPartnerRef) {
            const unitKind = federationUnitKinds[safe.unit];
            const uomId = event.batchId && unitKind
              ? localUnitByBatchKind.get(`${event.batchId}:${unitKind}`) : undefined;
            if (uomId) result.push({ eventId: event.id,
              sourceDocumentId: safe.sourceDocument.id, sourceLineId: safe.sourceLineId,
              kind: "sale", quantity: safe.quantity, uomId, uomCode: safe.unit,
              verificationState: "partner_asserted",
              partner: { issuerInstanceId: safe.downstreamPartnerRef } });
          }
        }
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

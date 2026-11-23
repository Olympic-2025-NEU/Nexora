// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import { DomainError } from "@/platform/kernel/errors";
import { createTradingRepos } from "../infrastructure/prisma-repos";
import type { DocumentStatus } from "../domain/document";

type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit: () => void };
export type HistoryFilters = { type?: string; status?: DocumentStatus; batchId?: string; partnerId?: string;
  from?: Date; to?: Date; cursorId?: string; limit?: number };

type DocRow = Prisma.DocumentGetPayload<object>;
type TransferRow = Prisma.TransferDetailGetPayload<object>;
type ReceivingRow = Prisma.ReceivingDetailGetPayload<object>;
type SaleRow = Prisma.SaleDetailGetPayload<object>;

function summary(doc: DocRow, transfer?: TransferRow, receiving?: ReceivingRow, sale?: SaleRow) {
  return {
    id: doc.id, documentType: doc.documentType, documentNumber: doc.documentNumber, status: doc.status,
    version: doc.version, issuePurpose: doc.issuePurpose, createdBySub: doc.createdBySub,
    createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
    confirmedBySub: doc.confirmedBySub, correctionOfDocumentId: doc.correctionOfDocumentId,
    ...(transfer ? { linkedIssueId: transfer.linkedIssueId, destinationPartnerId: transfer.destinationPartnerId,
      deliveryState: transfer.deliveryState } : {}),
    ...(receiving ? { sourceIssuerInstanceId: receiving.sourceIssuerInstanceId,
      sourceTransferId: receiving.sourceTransferId, inboundMessageId: receiving.inboundMessageId } : {}),
    ...(sale ? { linkedIssueId: sale.linkedIssueId, soldAt: sale.soldAt.toISOString() } : {}),
  };
}

export function createHistoryService() {
  return {
    async list(ctx: Context, filters: HistoryFilters) {
      let sourceIssuerInstanceId: string | undefined;
      if (filters.partnerId) {
        const partner = await ctx.tx.partner.findUnique({ where: { id: filters.partnerId } });
        if (!partner) return { items: [], nextCursorId: null as string | null };
        sourceIssuerInstanceId = partner.issuerInstanceId;
      }
      const page = await createTradingRepos(ctx.tx).list({
        type: filters.type as never, status: filters.status, from: filters.from, to: filters.to,
        partnerId: filters.partnerId, sourceIssuerInstanceId, batchId: filters.batchId,
        cursorId: filters.cursorId, limit: Math.min(Math.max(filters.limit ?? 20, 1), 100),
        ...(ctx.actor.roles.includes("administrator") ? {} :
          { warehouseIds: ctx.actor.unitIds, creatorSub: ctx.actor.userId }),
      });
      const ids = page.items.map((doc) => doc.id);
      const [transfers, receivings, sales] = await Promise.all([
        ctx.tx.transferDetail.findMany({ where: { documentId: { in: ids } } }),
        ctx.tx.receivingDetail.findMany({ where: { documentId: { in: ids } } }),
        ctx.tx.saleDetail.findMany({ where: { documentId: { in: ids } } }),
      ]);
      const byId = (rows: { documentId: string }[]) => new Map(rows.map((row) => [row.documentId, row]));
      const transferBy = byId(transfers), receivingBy = byId(receivings), saleBy = byId(sales);
      return { items: page.items.map((doc) => summary(doc, transferBy.get(doc.id) as TransferRow | undefined,
        receivingBy.get(doc.id) as ReceivingRow | undefined, saleBy.get(doc.id) as SaleRow | undefined)),
        nextCursorId: page.nextCursorId };
    },
    async view(ctx: Context, id: string) {
      const doc = await ctx.tx.document.findUnique({ where: { id }, include: {
        lines: { orderBy: { lineNo: "asc" } }, transferDetail: true, receivingDetail: true, saleDetail: true,
        corrections: { select: { id: true, documentNumber: true, status: true } },
      } });
      if (!doc) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (!ctx.actor.roles.includes("administrator")) {
        for (const line of doc.lines) {
          if (!ctx.actor.unitIds.includes(line.warehouseId)) {
            throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
          }
        }
      }
      const movements = await ctx.tx.stockMovement.findMany({
        where: { sourceLineId: { in: doc.lines.map((line) => line.id) } }, orderBy: { createdAt: "asc" } });
      const approval = await ctx.tx.approvalRequest.findUnique({ where: { documentId: id } });
      return {
        ...summary(doc, doc.transferDetail ?? undefined, doc.receivingDetail ?? undefined,
          doc.saleDetail ?? undefined),
        note: doc.note, correctionReason: doc.correctionReason,
        corrections: doc.corrections,
        lines: doc.lines.map((line) => ({ id: line.id, lineNo: line.lineNo, warehouseId: line.warehouseId,
          batchId: line.batchId, productVariantId: line.productVariantId, productId: line.productId,
          quantity: line.quantity?.toFixed(3) ?? null, actualQuantity: line.actualQuantity?.toFixed(3) ?? null,
          countedQuantity: line.countedQuantity?.toFixed(3) ?? null, uomId: line.uomId,
          sourceIssueLineId: line.sourceIssueLineId })),
        movements: movements.map((movement) => ({ id: movement.id, lineId: movement.sourceLineId,
          kind: movement.kind, delta: movement.delta.toFixed(3), balanceAfter: movement.balanceAfter.toFixed(3),
          actorSub: movement.actorSub, createdAt: movement.createdAt.toISOString() })),
        approval: approval ? { id: approval.id, state: approval.state,
          processInstanceId: approval.flowableProcessId } : null,
        ...(doc.transferDetail ? { delivery: { state: doc.transferDetail.deliveryState,
          technicalAckAt: doc.transferDetail.technicalAckAt?.toISOString() ?? null,
          businessReceiptAt: doc.transferDetail.businessReceiptAt?.toISOString() ?? null } } : {}),
        ...(doc.receivingDetail ? { discrepancyReason: doc.receivingDetail.discrepancyReason,
          sentQuantity: doc.receivingDetail.sentQuantity.toFixed(3) } : {}),
      };
    },
  };
}

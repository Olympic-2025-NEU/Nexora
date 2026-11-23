// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DocumentType, DocumentStatus } from "../domain/document";

export class TradingUniqueViolation extends Error {
  constructor(readonly constraint: string) {
    super(constraint);
    this.name = "TradingUniqueViolation";
  }
}

const prefixes: Record<DocumentType, string> = {
  goods_receipt: "GR", goods_issue: "GI", partner_transfer: "PT",
  receiving_confirmation: "RC", stocktake: "ST", sale_record: "SR",
};

export function nextDocumentNumber(type: DocumentType): string {
  return `${prefixes[type]}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function createTradingRepos(tx: Prisma.TransactionClient) {
  return {
    nextDocumentNumber,

    async createDocument(input: Omit<Prisma.DocumentUncheckedCreateInput, "documentNumber"> & { documentNumber?: string }) {
      try {
        return await tx.document.create({ data: { ...input, documentNumber: input.documentNumber ?? nextDocumentNumber(input.documentType as DocumentType) } });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          const target = "meta" in error && error.meta && typeof error.meta === "object" && "target" in error.meta
            ? error.meta.target : null;
          const constraint = typeof target === "string" ? target
            : Array.isArray(target) && target.join(",") === "document_type,document_number"
              ? "uq_trading_document_number" : String(target ?? "unknown");
          throw new TradingUniqueViolation(constraint);
        }
        throw error;
      }
    },

    async updateDraft(id: string, expectedVersion: number, patch: Pick<Prisma.DocumentUncheckedUpdateManyInput, "note">) {
      const result = await tx.document.updateMany({
        where: { id, version: expectedVersion, status: "draft" },
        data: { ...patch, updatedAt: new Date(), version: { increment: 1 } },
      });
      return result.count === 1 ? tx.document.findUniqueOrThrow({ where: { id } }) : null;
    },

    async replaceLines(documentId: string, expectedVersion: number,
      lines: Omit<Prisma.DocumentLineUncheckedCreateInput, "documentId">[], note?: string) {
      const result = await tx.document.updateMany({
        where: { id: documentId, version: expectedVersion, status: "draft" },
        data: { version: { increment: 1 }, updatedAt: new Date(), ...(note !== undefined ? { note } : {}) },
      });
      if (!result.count) return null;
      await tx.documentLine.deleteMany({ where: { documentId } });
      if (lines.length) await tx.documentLine.createMany({ data: lines.map((line) => ({ ...line, documentId })) });
      return tx.document.findUniqueOrThrow({ where: { id: documentId } });
    },

    async attachDetail(input:
      | { type: "partner_transfer"; data: Prisma.TransferDetailUncheckedCreateInput }
      | { type: "receiving_confirmation"; data: Prisma.ReceivingDetailUncheckedCreateInput }
      | { type: "sale_record"; data: Prisma.SaleDetailUncheckedCreateInput }) {
      switch (input.type) {
        case "partner_transfer": return tx.transferDetail.create({ data: input.data });
        case "receiving_confirmation": return tx.receivingDetail.create({ data: input.data });
        case "sale_record": return tx.saleDetail.create({ data: input.data });
      }
    },

    getAggregate(id: string) {
      return tx.document.findUnique({ where: { id }, include: {
        lines: { orderBy: { lineNo: "asc" } }, transferDetail: true,
        receivingDetail: true, saleDetail: true,
      } });
    },
    async lockDocument(id: string) {
      await tx.$queryRaw`SELECT id FROM trading.document WHERE id = ${id}::uuid FOR UPDATE`;
    },
    async lockReceivingSource(issuer: string, transferId: string) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${issuer} || ':' || ${transferId}, 0))::text`;
    },

    findVariant(id: string) {
      return tx.productVariant.findUnique({ where: { id }, include: { product: true,
        uoms: { include: { uom: true } } } });
    },
    findBatch(id: string) { return tx.batch.findUnique({ where: { id } }); },
    findWarehouse(id: string) { return tx.warehouse.findUnique({ where: { id } }); },
    findOrganization() { return tx.organization.findUnique({ where: { singletonSlot: 1 } }); },
    findApproval(documentId: string) { return tx.approvalRequest.findUnique({ where: { documentId } }); },
    findApprovalHistory(approvalRequestId: string) {
      return tx.auditLog.findMany({ where: { targetType: "approval_request", targetId: approvalRequestId },
        orderBy: { createdAt: "asc" } });
    },
    async applyApprovalResult(documentId: string, result: "approved" | "rejected") {
      const changed = await tx.document.updateMany({ where: { id: documentId, documentType: "goods_issue",
        status: "pending_approval" }, data: { status: result, version: { increment: 1 }, updatedAt: new Date() } });
      return changed.count === 1 ? result :
        `existing:${(await tx.document.findUnique({ where: { id: documentId } }))?.status ?? "missing"}`;
    },
    findActiveCorrection(id: string) {
      return tx.document.findFirst({ where: { correctionOfDocumentId: id, status: { not: "cancelled" } } });
    },
    createLines(documentId: string, lines: Omit<Prisma.DocumentLineUncheckedCreateInput, "documentId">[]) {
      return tx.documentLine.createMany({ data: lines.map((line) => ({ ...line, documentId })) });
    },
    normalizeLine(id: string, quantity: string, uomId: string) {
      return tx.documentLine.update({ where: { id }, data: { quantity, uomId } });
    },
    async transition(id: string, status: string, expectedVersion: number, next: string, actorSub: string) {
      const changed = await tx.document.updateMany({ where: { id, status, version: expectedVersion },
        data: { status: next, version: { increment: 1 }, updatedAt: new Date(),
          ...(next === "confirmed" ? { confirmedAt: new Date(), confirmedBySub: actorSub } : {}),
          ...(next === "cancelled" ? { cancelledAt: new Date() } : {}) } });
      return changed.count === 1 ? tx.document.findUniqueOrThrow({ where: { id } }) : null;
    },
    async lockBalances(keys: readonly { warehouseId: string; batchId: string }[]) {
      for (const key of keys) {
        await tx.$queryRaw`SELECT warehouse_id FROM inventory.stock_balance
          WHERE warehouse_id = ${key.warehouseId}::uuid AND batch_id = ${key.batchId}::uuid FOR UPDATE`;
      }
      return tx.stockBalance.findMany({ where: { OR: keys.map((key) => ({
        warehouseId: key.warehouseId, batchId: key.batchId,
      })) } });
    },

    async list(filters: {
      status?: DocumentStatus; type?: DocumentType; from?: Date; to?: Date;
      partnerId?: string; batchId?: string; cursorId?: string; limit: number;
      warehouseIds?: readonly string[]; creatorSub?: string;
    }) {
      const where: Prisma.DocumentWhereInput = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { documentType: filters.type } : {}),
        ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lt: filters.to } } : {}),
        ...(filters.partnerId ? { transferDetail: { destinationPartnerId: filters.partnerId } } : {}),
        ...(filters.batchId ? { lines: { some: { batchId: filters.batchId } } } : {}),
        ...(filters.warehouseIds ? { OR: [
          { createdBySub: filters.creatorSub, lines: { none: {} } },
          { lines: { some: {}, every: { warehouseId: { in: [...filters.warehouseIds] } } } },
        ] } : {}),
      };
      const rows = await tx.document.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1, ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}) });
      const items = rows.slice(0, filters.limit);
      return { items, nextCursorId: rows.length > filters.limit ? items.at(-1)?.id ?? null : null };
    },
  };
}

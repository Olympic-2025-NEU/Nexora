// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "../../../platform/kernel/errors";
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
      await tx.issueSourceAllocation.deleteMany({ where: { issueLine: { documentId } } });
      await tx.documentLine.deleteMany({ where: { documentId } });
      if (lines.length) await tx.documentLine.createMany({ data: lines.map((line) => ({ ...line, documentId })) });
      return tx.document.findUniqueOrThrow({ where: { id: documentId } });
    },

    async attachDetail(input:
      | { type: "partner_transfer"; data: Prisma.TransferDetailUncheckedCreateInput }
      | { type: "receiving_confirmation"; data: Prisma.ReceivingDetailUncheckedCreateInput }
      | { type: "sale_record"; data: Prisma.SaleDetailUncheckedCreateInput }
      | { type: "goods_receipt"; data: Prisma.ReceiptDetailUncheckedCreateInput }) {
      switch (input.type) {
        case "partner_transfer": return tx.transferDetail.create({ data: input.data });
        case "receiving_confirmation": return tx.receivingDetail.create({ data: input.data });
        case "sale_record": return tx.saleDetail.create({ data: input.data });
        case "goods_receipt": return tx.receiptDetail.create({ data: input.data });
      }
    },

    getAggregate(id: string) {
      return tx.document.findUnique({ where: { id }, include: {
        lines: { orderBy: { lineNo: "asc" }, include: { sourceAllocations: true } }, transferDetail: true,
        receivingDetail: true, receiptDetail: { include: { localSupplier: true } }, saleDetail: true,
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
    async checkSourceReferences(lines: readonly { warehouseId: string; batchId: string;
      productVariantId: string; sources?: { sourceLineId: string }[] }[],
    stockUomIds: readonly string[]) {
      const ids = [...new Set(lines.flatMap((line) => line.sources?.map((row) => row.sourceLineId) ?? []))];
      if (!ids.length) return;
      const sources = await tx.documentLine.findMany({ where: { id: { in: ids } },
        include: { document: { select: { status: true, documentType: true } } } });
      const byId = new Map(sources.map((row) => [row.id, row]));
      for (const [index, line] of lines.entries()) for (const reference of line.sources ?? []) {
        const source = byId.get(reference.sourceLineId);
        if (!source || source.document.status !== "confirmed" ||
            !["goods_receipt", "receiving_confirmation"].includes(source.document.documentType) ||
            source.warehouseId !== line.warehouseId || source.batchId !== line.batchId ||
            source.productVariantId !== line.productVariantId || source.uomId !== stockUomIds[index] ||
            (source.document.documentType === "receiving_confirmation"
              ? !source.actualQuantity || source.actualQuantity.lte(0)
              : !source.quantity || source.quantity.lte(0)))
          throw new DomainError("ISSUE_SOURCE_INVALID", 422);
      }
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

    async validateIssueSources(lines: readonly { id: string; warehouseId: string; batchId: string;
      productId: string; productVariantId: string; uomId: string; quantity: Decimal | null;
      sourceAllocations: { sourceLineId: string; quantity: Decimal }[] }[]) {
      const allocations = lines.flatMap((line) => line.sourceAllocations);
      if (!allocations.length) return; // Legacy issues stay explicitly unallocated in trace.
      if (lines.some((line) => !line.quantity || !line.sourceAllocations.length ||
        !line.sourceAllocations.reduce((sum, row) => sum.plus(row.quantity), new Decimal(0))
          .eq(line.quantity!))) throw new DomainError("ISSUE_SOURCE_INCOMPLETE", 422);
      const ids = [...new Set(allocations.map((row) => row.sourceLineId))].sort();
      for (const id of ids) {
        await tx.$queryRaw`SELECT id FROM trading.document_line WHERE id = ${id}::uuid FOR UPDATE`;
        const source = await tx.documentLine.findUnique({ where: { id },
          include: { document: { select: { status: true, documentType: true } },
            uom: { select: { kind: true } } } });
        if (!source || source.document.status !== "confirmed" ||
            !["goods_receipt", "receiving_confirmation"].includes(source.document.documentType))
          throw new DomainError("ISSUE_SOURCE_INVALID", 422);
        const sourceQuantity = source.document.documentType === "receiving_confirmation"
          ? source.actualQuantity : source.quantity;
        if (!sourceQuantity || sourceQuantity.lte(0)) throw new DomainError("ISSUE_SOURCE_INVALID", 422);
        for (const line of lines.filter((item) => item.sourceAllocations.some((row) => row.sourceLineId === id))) {
          if (line.warehouseId !== source.warehouseId || line.batchId !== source.batchId ||
              line.productId !== source.productId || line.productVariantId !== source.productVariantId ||
              line.uomId !== source.uomId) throw new DomainError("ISSUE_SOURCE_INVALID", 422);
        }
        const prior = await tx.issueSourceAllocation.aggregate({ where: { sourceLineId: id,
          issueLineId: { notIn: lines.map((line) => line.id) },
          issueLine: { document: { status: "confirmed" } } }, _sum: { quantity: true } });
        const current = allocations.filter((row) => row.sourceLineId === id)
          .reduce((sum, row) => sum.plus(row.quantity), new Decimal(0));
        if (source.uom.kind === "count" && allocations.some((row) =>
          row.sourceLineId === id && !row.quantity.isInteger()))
          throw new DomainError("ISSUE_SOURCE_INVALID", 422);
        if ((prior._sum.quantity ?? new Decimal(0)).plus(current).gt(sourceQuantity))
          throw new DomainError("ISSUE_SOURCE_OVERALLOCATED", 409);
      }
    },

    async list(filters: {
      status?: DocumentStatus; type?: DocumentType; from?: Date; to?: Date;
      partnerId?: string; sourceIssuerInstanceId?: string; batchId?: string; cursorId?: string; limit: number;
      warehouseIds?: readonly string[]; creatorSub?: string;
    }) {
      const where: Prisma.DocumentWhereInput = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { documentType: filters.type } : {}),
        ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lt: filters.to } } : {}),
        ...(filters.partnerId ? { AND: [{ OR: [
          { transferDetail: { destinationPartnerId: filters.partnerId } },
          ...(filters.sourceIssuerInstanceId ? [{ receivingDetail: { sourceIssuerInstanceId: filters.sourceIssuerInstanceId } }] : []),
        ] }] } : {}),
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

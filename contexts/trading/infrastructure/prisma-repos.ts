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
      lines: Omit<Prisma.DocumentLineUncheckedCreateInput, "documentId">[]) {
      const result = await tx.document.updateMany({
        where: { id: documentId, version: expectedVersion, status: "draft" },
        data: { version: { increment: 1 }, updatedAt: new Date() },
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

    async list(filters: {
      status?: DocumentStatus; type?: DocumentType; from?: Date; to?: Date;
      partnerId?: string; batchId?: string; cursorId?: string; limit: number;
    }) {
      const where: Prisma.DocumentWhereInput = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { documentType: filters.type } : {}),
        ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lt: filters.to } } : {}),
        ...(filters.partnerId ? { transferDetail: { destinationPartnerId: filters.partnerId } } : {}),
        ...(filters.batchId ? { lines: { some: { batchId: filters.batchId } } } : {}),
      };
      const rows = await tx.document.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1, ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}) });
      const items = rows.slice(0, filters.limit);
      return { items, nextCursorId: rows.length > filters.limit ? items.at(-1)?.id ?? null : null };
    },
  };
}

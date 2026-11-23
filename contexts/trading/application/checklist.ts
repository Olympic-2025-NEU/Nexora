// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";
import { Decimal } from "@prisma/client/runtime/library";
import { applyDocumentAction, assertCorrection, type DocumentType, type DocumentStatus } from "../domain/document";

export function checkTransition(type: "goods_receipt" | "goods_issue", status: string, action: "edit" | "submit" | "confirm" | "cancel") {
  if (type === "goods_issue" && action === "confirm" && status === "pending_approval") return;
  applyDocumentAction({ type, status: status as DocumentStatus, action });
}

export function checkCorrection(input: { documentId: string; documentType: DocumentType;
  correctionOfDocumentId?: string | null; correctionReason?: string | null;
  sourceType?: DocumentType; sourceStatus?: DocumentStatus; existingActiveCorrection?: boolean }) {
  assertCorrection(input);
}

export function checkLines(lines: readonly { lineNo: number; warehouseId: string; batchId: string;
  productVariantId: string; productId: string; uomId: string; quantity: string | null }[]) {
  if (!lines.length) throw new DomainError("NO_LINES", 422);
  const seen = new Set<number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.lineNo) || line.lineNo < 1 || seen.has(line.lineNo)) {
      throw new DomainError("LINE_NUMBER_INVALID", 422);
    }
    seen.add(line.lineNo);
    if (!line.warehouseId || !line.batchId || !line.productVariantId || !line.productId || !line.uomId || line.quantity === null) {
      throw new DomainError("MISSING_LINE_FIELD", 422);
    }
  }
}

export function aggregateDemand(lines: readonly { warehouseId: string; batchId: string; quantity: Decimal }[]) {
  const demand = new Map<string, { warehouseId: string; batchId: string; requested: Decimal }>();
  for (const line of lines) {
    const key = `${line.warehouseId}:${line.batchId}`;
    const current = demand.get(key);
    demand.set(key, { warehouseId: line.warehouseId, batchId: line.batchId,
      requested: (current?.requested ?? new Decimal(0)).add(line.quantity) });
  }
  return [...demand.values()].sort((a, b) =>
    a.warehouseId.localeCompare(b.warehouseId) || a.batchId.localeCompare(b.batchId));
}

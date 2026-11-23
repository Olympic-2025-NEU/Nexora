// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";
import type { OrganizationId } from "@/platform/kernel/id";

export type InvoiceSide = "receivable" | "payable";

export type InvoiceDraft = {
  id: string;
  organizationId: OrganizationId;
  side: InvoiceSide;
  sourceType: string;
  sourceId: string;
  partnerId: string;
  amount: number;
};

/** Finance tự lập hóa đơn từ sự kiện. Sales không ghi bảng công nợ. */
export function draftInvoice(input: InvoiceDraft): InvoiceDraft {
  if (input.amount <= 0) {
    throw new DomainError("AMOUNT_INVALID", 422);
  }
  if (!input.sourceType.trim() || !input.sourceId.trim()) {
    throw new DomainError("SOURCE_REQUIRED", 422);
  }
  return input;
}

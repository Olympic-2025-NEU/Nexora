// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";

export const SALES_ORDER_STATUSES = ["draft", "paid", "fulfilled", "cancelled"] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "transfer", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Daily sequence pad: ORD-YYYYMMDD-0001 … -9999; beyond that width grows (10000, …). */
export const ORDER_NUMBER_MIN_SEQ_WIDTH = 4;

export type SalesOrderLineInput = {
  productVariantId: string;
  uomId: string;
  quantity: string;
  unitPrice?: string;
  priceType?: "retail" | "wholesale";
  lineDiscount?: string;
};

export function assertPositiveQuantity(quantity: string) {
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
}

export function assertMoney(amount: string, code = "AMOUNT_INVALID") {
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(amount) || Number(amount) < 0) {
    throw new DomainError(code, 422);
  }
}

export function orderNumberDayKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10).replaceAll("-", "");
}

export function orderNumberPrefix(day: string = orderNumberDayKey()): string {
  return `ORD-${day}-`;
}

/** Parse daily sequence from `ORD-YYYYMMDD-0001` (also accepts wider pads). */
export function parseOrderNumberSequence(orderNumber: string, dayPrefix: string): number | null {
  if (!orderNumber.startsWith(dayPrefix)) return null;
  const suffix = orderNumber.slice(dayPrefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  const seq = Number(suffix);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

/**
 * Format sequence: pad to 4 digits through 9999; at 10000+ use natural width
 * (`ORD-…-10000`). Illustration of 5-digit pad after overflow: `-00001` width.
 */
export function formatOrderNumber(day: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new DomainError("ORDER_SEQ_INVALID", 500);
  }
  const width = Math.max(ORDER_NUMBER_MIN_SEQ_WIDTH, String(seq).length);
  return `${orderNumberPrefix(day)}${String(seq).padStart(width, "0")}`;
}

/** Next number after the highest parsed daily sequence (starts at 0001). */
export function allocateOrderNumber(existingNumbers: readonly string[], at: Date = new Date()): string {
  const day = orderNumberDayKey(at);
  const prefix = orderNumberPrefix(day);
  let maxSeq = 0;
  for (const number of existingNumbers) {
    const seq = parseOrderNumberSequence(number, prefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  return formatOrderNumber(day, maxSeq + 1);
}

/** @deprecated Prefer allocateOrderNumber with DB lookup; kept for callers that only need a sample shape. */
export function nextOrderNumber(at: Date = new Date()): string {
  return formatOrderNumber(orderNumberDayKey(at), 1);
}

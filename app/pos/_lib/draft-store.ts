// SPDX-License-Identifier: AGPL-3.0-only

/** In-memory POS draft — survives soft navigations within the SPA tab. */

export type PosPayMethod = "cash" | "transfer" | "card";

export type PosCartLine = {
  productId: string;
  productVariantId: string;
  uomId: string;
  name: string;
  sku: string;
  uomName: string;
  unitPrice: number;
  qty: number;
  attachmentId?: string | null;
};

export type PosOrderDraft = {
  cart: PosCartLine[];
  sellerId: string;
  customerId: string;
  warehouseId: string;
  soldAt: string;
  discountRaw: string;
  paidRaw: string;
  payMethod: PosPayMethod;
};

let draft: PosOrderDraft | null = null;

export function readPosOrderDraft(): PosOrderDraft | null {
  return draft;
}

export function writePosOrderDraft(next: PosOrderDraft): void {
  draft = {
    ...next,
    cart: next.cart.map((line) => ({ ...line })),
  };
}

export function clearPosOrderDraft(): void {
  draft = null;
}

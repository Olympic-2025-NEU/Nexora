// SPDX-License-Identifier: AGPL-3.0-only

export type QualityStatus = "available" | "restricted" | "inspect";
export type UomKind = "count" | "mass" | "volume";
export type PriceType = "purchase" | "retail" | "wholesale";

export type ProductRecord = {
  id: string;
  name: string;
  searchText: string;
  attributes: Record<string, unknown>;
  categoryId: string;
  isActive: boolean;
  deletedAt: string | null;
  version: number;
  createdBySub: string;
  createdAt: string;
  updatedAt: string;
};

/** List projection with variant summary for index UI. */
export type ProductListItem = ProductRecord & {
  variantCount: number;
  primaryVariantId: string | null;
  primarySku: string | null;
  primaryBarcode: string | null;
  /** Base UOM id / display name (from attributes.baseUomId or stock-keeping UOM). */
  baseUomId: string | null;
  baseUomName: string | null;
  pricePurchase: string | null;
  priceRetail: string | null;
  priceWholesale: string | null;
  /** Primary (or first) product image attachment for list thumbnails. */
  primaryImageAttachmentId: string | null;
};

export type ProductVariantRecord = {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  isPrimary: boolean;
  isActive: boolean;
  deletedAt: string | null;
  version: number;
  createdBySub: string;
};

export type ProductImageRecord = {
  id: string;
  productId: string;
  attachmentId: string;
  sortOrder: number;
  isPrimary: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CategoryRecord = {
  id: string;
  code: string;
  name: string;
  nameNormalized: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
  version: number;
};

export type UomRecord = {
  id: string;
  code: string;
  name: string;
  nameKey: string;
  kind: UomKind;
  isSystemDefault: boolean;
  isActive: boolean;
  deletedAt: string | null;
  version: number;
};

export type ProductVariantUomRecord = {
  id: string;
  productVariantId: string;
  uomId: string;
  isStockKeeping: boolean;
  factorToStockUom: string;
};

export type PriceListRecord = {
  id: string;
  code: string | null;
  name: string;
  isDefault: boolean;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  currency: string;
  deletedAt: string | null;
  version: number;
};

export type PriceListItemRecord = {
  id: string;
  priceListId: string;
  productVariantId: string;
  uomId: string;
  priceType: PriceType;
  amount: string;
  isActive: boolean;
};

export type BatchRecord = {
  id: string;
  productId: string;
  productVariantId: string;
  localCode: string;
  originIssuerInstanceId: string;
  originLotId: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  qualityStatus: QualityStatus;
  sourcePartnerId: string | null;
  version: number;
};

/** @deprecated P06 identifier — removed after P065 */
export type ProductIdentifierRecord = never;

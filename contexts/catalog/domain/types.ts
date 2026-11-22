// SPDX-License-Identifier: AGPL-3.0-only
import type { BaseUnit } from "./quantity";

export type ProductStatus = "active" | "archived";
export type QualityStatus = "available" | "restricted" | "inspect";
export type IdentifierKind = "ean13" | "internal_barcode";

export type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  baseUnit: BaseUnit;
  status: ProductStatus;
  version: number;
  createdBySub: string;
};

export type ProductIdentifierRecord = {
  id: string;
  productId: string;
  kind: IdentifierKind;
  value: string;
  isPrimary: boolean;
};

export type BatchRecord = {
  id: string;
  productId: string;
  localCode: string;
  originIssuerInstanceId: string;
  originLotId: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  qualityStatus: QualityStatus;
  sourcePartnerId: string | null;
  version: number;
};

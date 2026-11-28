// SPDX-License-Identifier: AGPL-3.0-only

export type LocalSupplierRow = {
  id: string;
  code: string;
  displayName: string;
  status: string;
  contactPhone: string | null;
  contactEmail: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

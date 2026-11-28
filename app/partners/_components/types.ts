// SPDX-License-Identifier: AGPL-3.0-only

export type PartnerRow = {
  id: string;
  code: string;
  displayName: string;
  issuerInstanceId: string;
  status: string;
  connectionStatus?: string | null;
  contactEmail?: string | null;
  version: number;
};

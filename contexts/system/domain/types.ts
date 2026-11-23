// SPDX-License-Identifier: AGPL-3.0-only

export type MembershipRole = "administrator" | "staff" | "approver" | "viewer";
export type MembershipStatus = "invited" | "active" | "disabled";
export type OrganizationStatus = "active" | "suspended";
export type PartnerStatus = "active" | "suspended";
export type ConnectionStatus = "active" | "rotating" | "disabled";

export type OrganizationRecord = {
  id: string;
  instanceId: string;
  code: string;
  name: string;
  timezone: string;
  status: OrganizationStatus;
  version: number;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
};

export type MembershipRecord = {
  id: string;
  organizationId: string;
  keycloakSub: string;
  displayName: string;
  email: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  version: number;
  warehouseIds?: string[];
};

export type PartnerRecord = {
  id: string;
  issuerInstanceId: string;
  code: string;
  displayName: string;
  status: PartnerStatus;
  contactEmail: string | null;
  version: number;
  connectionStatus?: ConnectionStatus | null;
};

export type PartnerConnectionRecord = {
  id: string;
  partnerId: string;
  endpointUrl: string;
  outboundTokenUrl: string;
  outboundClientId: string;
  outboundSecretRef: string;
  outboundAudience: string;
  inboundClientId: string;
  allowedInboundScope: string;
  status: ConnectionStatus;
  version: number;
  lastVerifiedAt: Date | null;
  rotatedAt: Date | null;
};

export const MEMBERSHIP_ROLES: readonly MembershipRole[] = [
  "administrator",
  "staff",
  "approver",
  "viewer",
];

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

// SPDX-License-Identifier: AGPL-3.0-only

/** Fixed job-role codes (ADR 0018). Multi-assign per membership. */
export type MembershipRole =
  | "administrator"
  | "catalog_manager"
  | "inventory_clerk"
  | "sales_clerk"
  | "stocktake_clerk"
  | "issue_approver"
  | "quality_officer"
  | "auditor";

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
  /** @deprecated Prefer `roles`; kept as primary denormalized role. */
  role: MembershipRole;
  roles: MembershipRole[];
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
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
] as const;

/** Priority for denormalized primary `membership.role`. */
const ROLE_PRIORITY: readonly MembershipRole[] = [
  "administrator",
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

export function normalizeMembershipRoles(roles: readonly string[]): MembershipRole[] {
  const unique = [...new Set(roles.filter(isMembershipRole))];
  if (unique.length === 0) return [];
  return ROLE_PRIORITY.filter((r) => unique.includes(r));
}

export function primaryMembershipRole(roles: readonly MembershipRole[]): MembershipRole {
  const normalized = normalizeMembershipRoles(roles);
  if (normalized.length === 0) throw new Error("MEMBERSHIP_ROLES_REQUIRED");
  return normalized[0]!;
}

/** Legacy single-role → job-role bundle (migration / invite compat). */
export function expandLegacyMembershipRole(role: string): MembershipRole[] {
  switch (role) {
    case "administrator":
      return ["administrator"];
    case "staff":
      return ["catalog_manager", "inventory_clerk", "sales_clerk", "stocktake_clerk"];
    case "approver":
      return ["issue_approver", "auditor"];
    case "viewer":
      return ["auditor"];
    default:
      return isMembershipRole(role) ? [role] : [];
  }
}

export function rolesRequireMfa(roles: readonly MembershipRole[]): boolean {
  return roles.includes("administrator") || roles.includes("issue_approver");
}

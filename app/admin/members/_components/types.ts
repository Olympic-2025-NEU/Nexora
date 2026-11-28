// SPDX-License-Identifier: AGPL-3.0-only

import { MEMBERSHIP_ROLES, type MembershipRole } from "@/contexts/system/domain/types";

export type MemberRow = {
  id: string;
  displayName: string;
  email?: string | null;
  role: string;
  roles?: MembershipRole[];
  status: string;
  version: number;
};

export type MemberStatus = "invited" | "active" | "disabled";

export function roleLabel(t: (k: string) => string, role: string): string {
  const key = `roles.${role}`;
  const translated = t(key);
  return translated !== key ? translated : role;
}

export function statusLabel(t: (k: string) => string, status: string): string {
  const key = `admin.memberStatus.${status}`;
  const translated = t(key);
  return translated !== key ? translated : status;
}

export function memberRoles(m: MemberRow): MembershipRole[] {
  if (m.roles?.length) return m.roles;
  return MEMBERSHIP_ROLES.includes(m.role as MembershipRole)
    ? [m.role as MembershipRole]
    : [];
}

export function formatRolesSummary(t: (k: string) => string, m: MemberRow): string {
  const roles = memberRoles(m);
  if (roles.length === 0) return "—";
  return roles.map((r) => roleLabel(t, r)).join(", ");
}

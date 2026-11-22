// SPDX-License-Identifier: AGPL-3.0-only

/** Role codes from membership (policy.ts). */
export type AppRole =
  | "administrator"
  | "staff"
  | "approver"
  | "viewer"
  | string;

export type NavItem = {
  href: string;
  labelKey: string;
  /** Roles that may see this link. Empty = all authenticated. */
  roles: AppRole[] | "*";
};

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/organization",
    labelKey: "nav.organization",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/admin/members",
    labelKey: "nav.members",
    roles: ["administrator"],
  },
  {
    href: "/admin/partners",
    labelKey: "nav.partners",
    roles: "*",
  },
  {
    href: "/admin/products",
    labelKey: "nav.products",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/admin/batches",
    labelKey: "nav.batches",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/admin/warehouses",
    labelKey: "nav.warehouses",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/admin/inventory",
    labelKey: "nav.inventory",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
];

export function filterNavByRoles(
  items: NavItem[],
  roles: string[],
): NavItem[] {
  const set = new Set(roles.map((r) => r.toLowerCase()));
  return items.filter((item) => {
    if (item.roles === "*") return true;
    return item.roles.some((r) => set.has(String(r).toLowerCase()));
  });
}

export function primaryRole(roles: string[]): string {
  const order = ["administrator", "staff", "approver", "viewer"];
  const lower = roles.map((r) => r.toLowerCase());
  for (const r of order) {
    if (lower.includes(r)) return r;
  }
  return roles[0] ?? "viewer";
}

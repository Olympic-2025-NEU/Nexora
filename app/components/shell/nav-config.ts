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
  /** Roles that may see this link. "*" = all authenticated. */
  roles: AppRole[] | "*";
};

/**
 * Single ERP app nav (catalog / inventory / partners).
 * System admin routes are opened from the user menu (administrator only).
 */
export const APP_NAV: NavItem[] = [
  {
    href: "/catalog/products",
    labelKey: "nav.products",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/categories",
    labelKey: "nav.categories",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/uom",
    labelKey: "nav.uom",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/pricing",
    labelKey: "nav.pricing",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/batches",
    labelKey: "nav.batches",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/inventory/warehouses",
    labelKey: "nav.warehouses",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/inventory/balances",
    labelKey: "nav.inventory",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/partners",
    labelKey: "nav.partners",
    roles: "*",
  },
  {
    href: "/trace",
    labelKey: "nav.trace",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/federation", labelKey: "nav.federationOperations", roles: ["administrator"] },
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

export function isAdministrator(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === "administrator");
}

export function primaryRole(roles: string[]): string {
  const order = ["administrator", "staff", "approver", "viewer"];
  const lower = roles.map((r) => r.toLowerCase());
  for (const r of order) {
    if (lower.includes(r)) return r;
  }
  return roles[0] ?? "viewer";
}

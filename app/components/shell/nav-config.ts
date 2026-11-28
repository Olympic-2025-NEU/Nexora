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
  section: string;
  /** Roles that may see this link. "*" = all authenticated. */
  roles: AppRole[] | "*";
};

/**
 * Single ERP app nav (catalog / inventory / partners).
 * System admin routes are opened from the user menu (administrator only).
 */
export const APP_NAV: NavItem[] = [
  {
    href: "/trading/transfers",
    labelKey: "nav.transfers",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/receivings",
    labelKey: "nav.receivings",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/receipts",
    labelKey: "nav.receipts",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/issues",
    labelKey: "nav.issues",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/sales",
    labelKey: "nav.sales",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/approvals",
    labelKey: "nav.approvals",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/stocktakes",
    labelKey: "nav.stocktakes",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trading/history",
    labelKey: "nav.history",
    section: "nav.groupTrading",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/partners",
    labelKey: "nav.partners",
    section: "nav.groupTrading",
    roles: "*",
  },
  {
    href: "/catalog/products",
    labelKey: "nav.products",
    section: "nav.groupCatalog",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/categories",
    labelKey: "nav.categories",
    section: "nav.groupCatalog",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/uom",
    labelKey: "nav.uom",
    section: "nav.groupCatalog",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/pricing",
    labelKey: "nav.pricing",
    section: "nav.groupCatalog",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/catalog/batches",
    labelKey: "nav.batches",
    section: "nav.groupCatalog",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/inventory/warehouses",
    labelKey: "nav.warehouses",
    section: "nav.groupInventory",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/inventory/balances",
    labelKey: "nav.inventory",
    section: "nav.groupInventory",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/trace",
    labelKey: "nav.trace",
    section: "nav.groupTrace",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/assistant",
    labelKey: "nav.assistant",
    section: "nav.groupTrace",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
];

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/federation",
    labelKey: "nav.federationOperations",
    section: "nav.admin",
    roles: ["administrator"],
  },
  {
    href: "/admin/organization",
    labelKey: "nav.organization",
    section: "nav.admin",
    roles: ["administrator", "staff", "approver", "viewer"],
  },
  {
    href: "/admin/members",
    labelKey: "nav.members",
    section: "nav.admin",
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

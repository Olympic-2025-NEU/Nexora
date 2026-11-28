// SPDX-License-Identifier: AGPL-3.0-only

/** Job-role codes from membership (ADR 0018 / policy.ts). */
export type AppRole =
  | "administrator"
  | "catalog_manager"
  | "inventory_clerk"
  | "sales_clerk"
  | "stocktake_clerk"
  | "issue_approver"
  | "quality_officer"
  | "auditor"
  | string;

const OPS_READ: AppRole[] = [
  "administrator",
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

export type NavLeaf = {
  href: string;
  labelKey: string;
  roles: AppRole[] | "*";
  descriptionKey?: string;
};

export type NavIcon =
  | "dashboard"
  | "products"
  | "warehouse"
  | "orders"
  | "reports"
  | "assistant"
  | "settings";

export type NavGroup = {
  id: string;
  labelKey: string;
  href?: string;
  roles: AppRole[] | "*";
  icon: NavIcon;
  children?: NavLeaf[];
  flyoutTitleKey?: string;
};

export const APP_NAV: NavGroup[] = [
  {
    id: "dashboard",
    labelKey: "nav.dashboard",
    href: "/dashboard",
    roles: "*",
    icon: "dashboard",
  },
  {
    id: "products",
    labelKey: "nav.products",
    roles: OPS_READ,
    icon: "products",
    flyoutTitleKey: "nav.flyoutProducts",
    children: [
      {
        href: "/products",
        labelKey: "nav.products",
        roles: OPS_READ,
        descriptionKey: "nav.descProducts",
      },
      {
        href: "/categories",
        labelKey: "nav.categories",
        roles: OPS_READ,
        descriptionKey: "nav.descCategories",
      },
      {
        href: "/uom",
        labelKey: "nav.uom",
        roles: OPS_READ,
        descriptionKey: "nav.descUom",
      },
    ],
  },
  {
    id: "warehouse",
    labelKey: "nav.warehouses",
    roles: OPS_READ,
    icon: "warehouse",
    flyoutTitleKey: "nav.flyoutWarehouse",
    children: [
      {
        href: "/inventory/warehouses",
        labelKey: "nav.warehouses",
        roles: OPS_READ,
        descriptionKey: "nav.descWarehouses",
      },
      {
        href: "/inventory/balances",
        labelKey: "nav.inventory",
        roles: OPS_READ,
        descriptionKey: "nav.descInventory",
      },
      {
        href: "/trading/stocktakes",
        labelKey: "nav.stocktakes",
        roles: ["administrator", "stocktake_clerk", "auditor", "issue_approver"],
        descriptionKey: "nav.descStocktakes",
      },
      {
        href: "/trading/inbound",
        labelKey: "nav.receivings",
        roles: ["administrator", "inventory_clerk", "auditor", "issue_approver"],
        descriptionKey: "nav.descReceivings",
      },
      {
        href: "/trading/suppliers",
        labelKey: "nav.suppliers",
        roles: ["administrator", "inventory_clerk", "catalog_manager", "auditor"],
        descriptionKey: "nav.descSuppliers",
      },
      {
        href: "/trading/issues",
        labelKey: "nav.issues",
        roles: ["administrator", "inventory_clerk", "auditor", "issue_approver"],
        descriptionKey: "nav.descIssues",
      },
      {
        href: "/trading/transfers",
        labelKey: "nav.transfers",
        roles: ["administrator", "inventory_clerk", "auditor", "issue_approver"],
        descriptionKey: "nav.descTransfers",
      },
      {
        href: "/trace",
        labelKey: "nav.trace",
        roles: OPS_READ,
        descriptionKey: "nav.descTrace",
      },
    ],
  },
  {
    id: "orders",
    labelKey: "nav.orders",
    roles: OPS_READ,
    icon: "orders",
    flyoutTitleKey: "nav.flyoutOrders",
    children: [
      {
        href: "/orders",
        labelKey: "nav.sales",
        roles: ["administrator", "sales_clerk", "auditor", "issue_approver"],
        descriptionKey: "nav.descSales",
      },
      {
        href: "/pos",
        labelKey: "nav.pos",
        roles: ["administrator", "sales_clerk"],
        descriptionKey: "nav.descPos",
      },
      {
        href: "/trading/approvals",
        labelKey: "nav.approvals",
        roles: ["administrator", "issue_approver"],
        descriptionKey: "nav.descApprovals",
      },
    ],
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    href: "/dashboard#reports",
    roles: "*",
    icon: "reports",
  },
  {
    id: "assistant",
    labelKey: "nav.assistant",
    href: "/assistant",
    roles: OPS_READ,
    icon: "assistant",
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    roles: OPS_READ,
    icon: "settings",
    flyoutTitleKey: "nav.flyoutSettings",
    children: [
      {
        href: "/admin/organization",
        labelKey: "nav.organization",
        roles: OPS_READ,
        descriptionKey: "nav.descOrganization",
      },
      {
        href: "/admin/members",
        labelKey: "nav.members",
        roles: ["administrator"],
        descriptionKey: "nav.descMembers",
      },
      {
        href: "/partners",
        labelKey: "nav.partners",
        roles: "*",
        descriptionKey: "nav.descPartners",
      },
    ],
  },
];

export type NavItem = NavLeaf;

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/organization",
    labelKey: "nav.organization",
    roles: OPS_READ,
  },
  {
    href: "/admin/members",
    labelKey: "nav.members",
    roles: ["administrator"],
  },
  {
    href: "/partners",
    labelKey: "nav.partners",
    roles: "*",
  },
];

export function roleAllowed(roles: AppRole[] | "*", userRoles: string[]): boolean {
  if (roles === "*") return true;
  const set = new Set(userRoles.map((r) => r.toLowerCase()));
  return roles.some((r) => set.has(String(r).toLowerCase()));
}

export function filterNavByRoles(groups: NavGroup[], roles: string[]): NavGroup[] {
  return groups
    .filter((g) => roleAllowed(g.roles, roles))
    .map((g) => {
      if (!g.children?.length) return g;
      const children = g.children.filter((c) => roleAllowed(c.roles, roles));
      return { ...g, children };
    })
    .filter((g) => g.href || (g.children && g.children.length > 0));
}

export function flattenNav(groups: NavGroup[]): NavItem[] {
  const out: NavItem[] = [];
  for (const g of groups) {
    if (g.href && !g.children?.length) {
      out.push({ href: g.href, labelKey: g.labelKey, roles: g.roles });
    }
    if (g.children) out.push(...g.children);
  }
  return out;
}

export function filterFlatNavByRoles(items: NavItem[], roles: string[]): NavItem[] {
  return items.filter((item) => roleAllowed(item.roles, roles));
}

export function isAdministrator(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === "administrator");
}

export function primaryRole(roles: string[]): string {
  const order = [
    "administrator",
    "catalog_manager",
    "inventory_clerk",
    "sales_clerk",
    "stocktake_clerk",
    "issue_approver",
    "quality_officer",
    "auditor",
  ];
  const lower = roles.map((r) => r.toLowerCase());
  for (const r of order) {
    if (lower.includes(r)) return r;
  }
  return roles[0] ?? "auditor";
}

export function isPathActive(pathname: string, href: string): boolean {
  const base = href.split("#")[0] ?? href;
  if (!base) return false;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function groupIsActive(pathname: string, group: NavGroup): boolean {
  if (group.href && isPathActive(pathname, group.href)) return true;
  return Boolean(group.children?.some((c) => isPathActive(pathname, c.href)));
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Application-level policy matrix for Nexora (ADR 0018).
 *
 * Job roles (membership, multi-assign):
 *   administrator | catalog_manager | inventory_clerk | sales_clerk |
 *   stocktake_clerk | issue_approver | quality_officer | auditor
 *
 * Synthetic: partner (M2M) | public
 *
 * Enforced at application boundary — not UI-only.
 * Action naming: "<module>:<resource>:<verb>"
 */

import type { Actor } from "../identity/actor.js";

export type NexoraRole =
  | "administrator"
  | "catalog_manager"
  | "inventory_clerk"
  | "sales_clerk"
  | "stocktake_clerk"
  | "issue_approver"
  | "quality_officer"
  | "auditor"
  | "partner"
  | "public";

/** Authenticated human job roles (excludes partner/public). */
const HUMAN: NexoraRole[] = [
  "administrator",
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

const READERS: NexoraRole[] = [
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

interface ActionPolicy {
  roles: NexoraRole[] | "*";
  adminAlwaysAllowed?: boolean;
}

const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // --- Platform ---
  "platform:me:read": { roles: HUMAN, adminAlwaysAllowed: true },
  "platform:health:read": { roles: "*" },
  "platform:audit:read": { roles: ["administrator"], adminAlwaysAllowed: true },
  "platform:operations:retry": { roles: ["administrator"], adminAlwaysAllowed: true },

  // --- Federation (M2M partner only) ---
  "federation:events:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:acks:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:connectivity:probe": { roles: ["partner"], adminAlwaysAllowed: false },

  // --- Admin / M01 ---
  "admin:organization:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:organization:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:read": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:partner:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:connection:manage": { roles: ["administrator"], adminAlwaysAllowed: true },

  // --- Workflow (issue approval) ---
  "workflow:approval:read": { roles: ["issue_approver"], adminAlwaysAllowed: false },
  "workflow:approval:decide": { roles: ["issue_approver"], adminAlwaysAllowed: false },

  // --- Trading ---
  "trading:history:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:receipt:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:receipt:create": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receipt:edit": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receipt:confirm": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receipt:cancel": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  // ADR 0020 — retail / non-Nexora suppliers (not system.Partner)
  "trading:local-supplier:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:local-supplier:manage": { roles: ["inventory_clerk", "catalog_manager"], adminAlwaysAllowed: true },
  "trading:inbound:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:issue:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:issue:create": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:edit": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:submit": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:confirm": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:cancel": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:transfer:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:transfer:create": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:transfer:confirm": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:transfer:cancel": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receiving:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:receiving:create": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receiving:update": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receiving:confirm": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:receiving:cancel": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:stocktake:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:stocktake:create": { roles: ["stocktake_clerk"], adminAlwaysAllowed: true },
  "trading:stocktake:update": { roles: ["stocktake_clerk"], adminAlwaysAllowed: true },
  "trading:stocktake:confirm": { roles: ["stocktake_clerk"], adminAlwaysAllowed: true },
  "trading:stocktake:cancel": { roles: ["stocktake_clerk"], adminAlwaysAllowed: true },
  "trading:sale:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:sale:create": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "trading:sale:confirm": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "trading:sale:cancel": { roles: ["sales_clerk"], adminAlwaysAllowed: true },

  // --- Commercial sales orders (ADR 0019) ---
  "sales:order:read": { roles: READERS, adminAlwaysAllowed: true },
  "sales:order:create": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "sales:order:checkout": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "sales:order:cancel": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "sales:order:trace:revoke": { roles: ["administrator"], adminAlwaysAllowed: true },

  // --- Traceability ---
  "trace:read": { roles: READERS, adminAlwaysAllowed: true },
  "trace:federation:publish": { roles: ["administrator"], adminAlwaysAllowed: true },
  "trace:passport-policy:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "trace:qr:manage": {
    roles: ["administrator", "inventory_clerk", "catalog_manager"],
    adminAlwaysAllowed: true,
  },
  "trace:evidence:manage": {
    roles: ["administrator", "inventory_clerk", "catalog_manager"],
    adminAlwaysAllowed: true,
  },
  "ops:quality:read": { roles: ["quality_officer"], adminAlwaysAllowed: true },
  "ops:quality:manage": { roles: ["quality_officer"], adminAlwaysAllowed: true },
  "ops:ot:ingest": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },

  // --- Catalog / Inventory ---
  "catalog:product:create": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:product:read": { roles: READERS, adminAlwaysAllowed: true },
  "catalog:product:manage": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:category:read": { roles: READERS, adminAlwaysAllowed: true },
  "catalog:category:manage": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:uom:read": { roles: READERS, adminAlwaysAllowed: true },
  "catalog:uom:manage": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:price_list:read": { roles: READERS, adminAlwaysAllowed: true },
  "catalog:price_list:manage": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:batch:read": { roles: READERS, adminAlwaysAllowed: true },
  "catalog:batch:create": { roles: ["catalog_manager", "inventory_clerk"], adminAlwaysAllowed: true },
  "catalog:batch:quality": {
    roles: ["catalog_manager", "inventory_clerk", "quality_officer"],
    adminAlwaysAllowed: true,
  },
  "inventory:warehouse:read": { roles: READERS, adminAlwaysAllowed: true },
  "inventory:warehouse:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "inventory:stock:read": { roles: READERS, adminAlwaysAllowed: true },
};

export interface PolicyResult {
  allowed: boolean;
  reason: string;
}

export function checkPolicy(actor: Actor, action: string): PolicyResult {
  const policy = ACTION_POLICIES[action];
  if (!policy) {
    return { allowed: false, reason: `Unknown action: ${action}` };
  }

  const actorRoles = actor.roles as NexoraRole[];

  if (policy.adminAlwaysAllowed && actorRoles.includes("administrator")) {
    return { allowed: true, reason: "administrator bypass" };
  }

  if (policy.roles === "*") {
    return { allowed: true, reason: "open to all authenticated actors" };
  }

  const hasRole = actorRoles.some((r) => (policy.roles as NexoraRole[]).includes(r));
  if (hasRole) {
    return { allowed: true, reason: `role ${actorRoles.join(",")} in allowed set` };
  }

  return {
    allowed: false,
    reason: `role(s) [${actorRoles.join(",")}] not in allowed set [${(policy.roles as NexoraRole[]).join(",")}] for action ${action}`,
  };
}

export class PolicyError extends Error {
  constructor(
    public readonly action: string,
    public readonly reason: string,
    public readonly httpStatus: 403 = 403,
  ) {
    super(`Policy denied for action '${action}': ${reason}`);
    this.name = "PolicyError";
  }
}

export function requirePolicy(actor: Actor, action: string): void {
  const result = checkPolicy(actor, action);
  if (!result.allowed) {
    throw new PolicyError(action, result.reason);
  }
}

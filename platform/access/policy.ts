// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Application-level policy matrix for Nexora.
 *
 * Roles: administrator | staff | approver | viewer | partner | public
 *
 * Policy is enforced at the application boundary (use-case/route handler),
 * NOT only in the UI. Gateway OIDC confirms the user is authenticated;
 * this module confirms they are authorised for the specific action.
 *
 * Action naming convention:  "<module>:<resource>:<verb>"
 *   e.g. "platform:me:read", "trading:goods-issue:create"
 *
 * Rules:
 * - `administrator` can perform any action in its domain.
 * - `staff` can create/update operational records; cannot perform admin actions.
 * - `approver` can read and approve/reject workflow decisions; cannot create.
 * - `viewer` has read-only access.
 * - `partner` has M2M access to federation endpoints only.
 * - `public` has no authenticated role; only public projections are allowed.
 */

import type { Actor } from "../identity/actor.js";

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

export type NexoraRole =
  | "administrator"
  | "staff"
  | "approver"
  | "viewer"
  | "partner"
  | "public";

// ---------------------------------------------------------------------------
// Action matrix
// ---------------------------------------------------------------------------

/**
 * Policy entry: which roles are allowed to perform an action.
 * An empty roles array means "no authenticated role" (public access).
 */
interface ActionPolicy {
  /** Roles that may perform this action. '*' means all authenticated roles. */
  roles: NexoraRole[] | "*";
  /** If true, administrator is always allowed regardless of roles list. */
  adminAlwaysAllowed?: boolean;
}

const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // --- Platform ---
  "platform:me:read": { roles: ["administrator", "staff", "approver", "viewer"], adminAlwaysAllowed: true },
  "platform:health:read": { roles: "*" },
  "platform:audit:read": { roles: ["administrator"], adminAlwaysAllowed: true },
  "platform:operations:retry": { roles: ["administrator"], adminAlwaysAllowed: true },

  // --- Federation (M2M partner only) ---
  "federation:events:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:acks:write": { roles: ["partner"], adminAlwaysAllowed: false },

  // --- Admin management ---
  "admin:membership:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:organization:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:manage": { roles: ["administrator"], adminAlwaysAllowed: true },

  // --- Trading (placeholder until P07) ---
  "trading:goods-issue:create": { roles: ["staff"], adminAlwaysAllowed: true },
  "trading:goods-issue:approve": { roles: ["approver"], adminAlwaysAllowed: true },
  "trading:goods-issue:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },

  // --- Catalog/Inventory (placeholder until P06) ---
  "catalog:product:create": { roles: ["administrator", "staff"], adminAlwaysAllowed: true },
  "catalog:product:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },
  "inventory:stock:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },
};

// ---------------------------------------------------------------------------
// Policy check result
// ---------------------------------------------------------------------------

export interface PolicyResult {
  allowed: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// checkPolicy
// ---------------------------------------------------------------------------

/**
 * Check whether the given Actor is allowed to perform `action`.
 *
 * Returns `{ allowed: true, reason: "..." }` or `{ allowed: false, reason: "..." }`.
 *
 * Usage:
 *   const { allowed } = checkPolicy(actor, "trading:goods-issue:create");
 *   if (!allowed) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
 */
export function checkPolicy(actor: Actor, action: string): PolicyResult {
  const policy = ACTION_POLICIES[action];
  if (!policy) {
    // Unknown action — deny by default (fail-closed).
    return { allowed: false, reason: `Unknown action: ${action}` };
  }

  const actorRoles = actor.roles as NexoraRole[];

  // Administrator bypass (only for policies that allow it).
  if (policy.adminAlwaysAllowed && actorRoles.includes("administrator")) {
    return { allowed: true, reason: "administrator bypass" };
  }

  if (policy.roles === "*") {
    // Any authenticated actor may perform this action.
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

// ---------------------------------------------------------------------------
// requirePolicy — throws PolicyError on deny (use in route handlers)
// ---------------------------------------------------------------------------

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

/**
 * Like `checkPolicy` but throws `PolicyError` when denied.
 * Convenient for route handlers that want to propagate the error up.
 */
export function requirePolicy(actor: Actor, action: string): void {
  const result = checkPolicy(actor, action);
  if (!result.allowed) {
    throw new PolicyError(action, result.reason);
  }
}

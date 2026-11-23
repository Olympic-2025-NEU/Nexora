// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolve an authenticated Actor from verified JWT claims + membership DB lookup.
 *
 * The Actor's organizationId and roles come exclusively from the DB membership row;
 * no field is trusted from the token body or request payload.
 *
 * MFA requirement for administrator/approver is enforced at the Keycloak realm level
 * (CONFIGURE_TOTP required action on those roles — see deploy/keycloak/).
 * The app layer confirms the role against the membership row and rejects stale/disabled entries.
 */

import type { Actor } from "./actor";
import { realmRoles, type NexoraClaims } from "./token";

/** Minimal DB membership row shape (matches system.membership + warehouse join). */
export interface MembershipRow {
  id: string;
  organizationId: string;
  keycloakSub: string;
  displayName: string;
  role: "administrator" | "staff" | "approver" | "viewer";
  status: "invited" | "active" | "disabled";
  /** Warehouse scope from system.membership_warehouse (empty = none for non-admin). */
  warehouseIds: string[];
}

/** Port: implement against PrismaClient in infrastructure layer. */
export interface MembershipRepository {
  findBySub(sub: string): Promise<MembershipRow | null>;
}

export class ActorResolutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: 401 | 403 = 403,
  ) {
    super(message);
    this.name = "ActorResolutionError";
  }
}

/**
 * Build an Actor from verified claims and the local membership row.
 *
 * Rules:
 * - `sub` must exist in system.membership with status='active'.
 * - `organizationId` comes from the membership row, never from the token.
 * - `roles` list is `[membership.role]`; token realm_roles used only for auditing mismatch.
 * - Disabled or invited memberships are rejected with 403.
 */
export async function resolveActor(
  claims: NexoraClaims,
  repo: MembershipRepository,
): Promise<Actor> {
  const membership = await repo.findBySub(claims.sub);

  if (!membership) {
    throw new ActorResolutionError(
      "MEMBERSHIP_NOT_FOUND",
      "No active membership found for authenticated user",
      403,
    );
  }

  if (membership.status !== "active") {
    throw new ActorResolutionError(
      "MEMBERSHIP_INACTIVE",
      `Membership status is ${membership.status}`,
      403,
    );
  }

  // Log if token realm_roles diverge from DB role (non-fatal; DB is authoritative).
  const tokenRoles = realmRoles(claims);
  if (!tokenRoles.includes(membership.role)) {
    // Intentionally not throwing — DB membership is source of truth; token may lag.
    // Caller can audit this via structured logging.
    console.warn(
      `[resolve-actor] Token realm roles differ from DB role '${membership.role}' for sub prefix ${claims.sub.slice(0, 8)}`,
    );
  }

  return {
    userId: membership.keycloakSub,
    organizationId: membership.organizationId,
    unitIds: membership.warehouseIds ?? [],
    roles: [membership.role],
    displayName: membership.displayName,
  };
}

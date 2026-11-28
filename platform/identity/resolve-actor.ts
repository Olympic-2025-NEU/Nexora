// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolve an authenticated Actor from verified JWT claims + membership DB lookup.
 *
 * organizationId and roles come exclusively from DB (membership + membership_role).
 * MFA for administrator / issue_approver is enforced at Keycloak (CONFIGURE_TOTP).
 */

import type { MembershipRole } from "@/contexts/system/domain/types";
import type { Actor } from "./actor";
import { realmRoles, type NexoraClaims } from "./token";

/** Minimal DB membership row shape (matches system.membership + roles + warehouses). */
export interface MembershipRow {
  id: string;
  organizationId: string;
  keycloakSub: string;
  displayName: string;
  /** @deprecated Prefer `roles`. */
  role: MembershipRole;
  roles: MembershipRole[];
  status: "invited" | "active" | "disabled";
  warehouseIds: string[];
}

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

  const roles =
    membership.roles?.length > 0
      ? membership.roles
      : membership.role
        ? [membership.role]
        : [];

  if (roles.length === 0) {
    throw new ActorResolutionError(
      "MEMBERSHIP_ROLES_MISSING",
      "Membership has no job roles assigned",
      403,
    );
  }

  const tokenRoles = realmRoles(claims);
  const missingInToken = roles.filter((r) => !tokenRoles.includes(r));
  if (missingInToken.length > 0) {
    console.warn(
      `[resolve-actor] Token realm roles missing DB roles [${missingInToken.join(",")}] for sub prefix ${claims.sub.slice(0, 8)}`,
    );
  }

  return {
    userId: membership.keycloakSub,
    organizationId: membership.organizationId,
    unitIds: membership.warehouseIds ?? [],
    roles,
    displayName: membership.displayName,
  };
}

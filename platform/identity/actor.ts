// SPDX-License-Identifier: AGPL-3.0-only
import type { OrgUnitId, OrganizationId, UserId } from "../kernel/id";

/** Authenticated caller. Role and unit come from token + membership DB; never from body. */
export type Actor = {
  userId: UserId;
  organizationId: OrganizationId;
  unitIds: readonly OrgUnitId[];
  roles: readonly string[];
  /** Membership display name (human-readable); not used for authorization. */
  displayName?: string;
};

/** @deprecated Use Actor.organizationId. Keeps legacy contexts compiling during migration. */
export type LegacyActorWithTenantId = Omit<Actor, "organizationId"> & { tenantId: OrganizationId };

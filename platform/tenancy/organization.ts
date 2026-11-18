// SPDX-License-Identifier: AGPL-3.0-only
import type { OrganizationId } from "../kernel/id";

export type Organization = {
  id: OrganizationId;
  name: string;
};

/** Every command must carry the actor's organization; never accept organizationId from client input. */
export function organizationOf(actorOrganizationId: OrganizationId): OrganizationId {
  return actorOrganizationId;
}

// ---------------------------------------------------------------------------
// Legacy alias — kept during migration; remove after all contexts updated.
// ---------------------------------------------------------------------------
/** @deprecated Use Organization */
export type Tenant = Organization;
/** @deprecated Use organizationOf */
export const tenantOf = organizationOf;

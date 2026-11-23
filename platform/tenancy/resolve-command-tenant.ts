// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "../identity/actor";
import type { PartnerActor } from "../identity/partner-actor";
import { DomainError } from "../kernel/errors";

export type CommandTenantRepository = {
  findMembershipOrganization(sub: string): Promise<string | null>;
  findOrganization(id: string): Promise<{ id: string; status: string } | null>;
  findLocalOrganization(): Promise<{ id: string; status: string } | null>;
};

/** Resolve membership -> organization before opening a command transaction. */
export async function resolveCommandTenant(
  actor: Actor | PartnerActor,
  repo: CommandTenantRepository,
): Promise<string> {
  const organizationId = "organizationId" in actor
    ? await repo.findMembershipOrganization(actor.userId)
    : null;
  if ("organizationId" in actor && organizationId !== actor.organizationId) {
    throw new DomainError("TENANT_FORBIDDEN", 403);
  }
  const organization = organizationId
    ? await repo.findOrganization(organizationId)
    : await repo.findLocalOrganization();
  if (!organization || organization.status !== "active") throw new DomainError("TENANT_FORBIDDEN", 403);
  return organization.id;
}

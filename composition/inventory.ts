// SPDX-License-Identifier: AGPL-3.0-only
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";

export function inventoryRepos() {
  return createInventoryRepos(getPrismaClient());
}

export function inventoryAuditRecorder() {
  return prismaAuditRecorder;
}

/**
 * Warehouse read scope: administrators see every warehouse (`undefined` = no filter);
 * everyone else is limited to the warehouses in `actor.unitIds`.
 */
export function warehouseScope(actor: {
  roles: readonly string[];
  unitIds: readonly string[];
}): readonly string[] | undefined {
  return actor.roles.includes("administrator") ? undefined : actor.unitIds;
}

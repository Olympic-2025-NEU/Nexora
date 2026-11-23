// SPDX-License-Identifier: AGPL-3.0-only
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";

export function catalogRepos() {
  return createCatalogRepos(getPrismaClient());
}

export function catalogAuditRecorder() {
  return prismaAuditRecorder;
}

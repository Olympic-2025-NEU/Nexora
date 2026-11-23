// SPDX-License-Identifier: AGPL-3.0-only
import { prismaAuditQueryRepository } from "../platform/audit/prisma-audit-query";
import { getPrismaClient } from "../platform/persistence/prisma";
import type { AuditHttpDependencies } from "../platform/audit/http-handler";
import { resolveUserActor } from "./system";

/** Keep Prisma wiring outside the HTTP route and application policy. */
export function auditHttpDependencies(): AuditHttpDependencies {
  const db = getPrismaClient();
  return {
    resolveActor: resolveUserActor,
    repository: prismaAuditQueryRepository(db),
  };
}

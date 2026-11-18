// SPDX-License-Identifier: AGPL-3.0-only
import { prismaAuditQueryRepository } from "../platform/audit/prisma-audit-query";
import { authenticate } from "../platform/identity/request-auth";
import { getPrismaClient } from "../platform/persistence/prisma";
import type { AuditHttpDependencies } from "../platform/audit/http-handler";

/** Keep Prisma wiring outside the HTTP route and application policy. */
export function auditHttpDependencies(): AuditHttpDependencies {
  const db = getPrismaClient();
  return {
    resolveActor(request) {
      return authenticate(request, {
        membershipRepo: {
          async findBySub(sub) {
            const row = await db.membership.findUnique({ where: { keycloakSub: sub } });
            if (!row) return null;
            return {
              id: row.id,
              organizationId: row.organizationId,
              keycloakSub: row.keycloakSub,
              role: row.role as "administrator" | "staff" | "approver" | "viewer",
              status: row.status as "invited" | "active" | "disabled",
            };
          },
        },
      });
    },
    repository: prismaAuditQueryRepository(db),
  };
}

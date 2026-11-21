// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { authenticate } from "@/platform/identity/request-auth";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createSystemRepos } from "@/contexts/system/infrastructure/prisma-repos";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import type { MembershipRepository } from "@/platform/identity/resolve-actor";

/** Shared Prisma membership port for user auth (admin-invite; no open JIT). */
export function membershipRepository(): MembershipRepository {
  const db = getPrismaClient();
  return {
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
  };
}

export async function resolveUserActor(request: NextRequest) {
  return authenticate(request, { membershipRepo: membershipRepository() });
}

export function systemRepos() {
  return createSystemRepos(getPrismaClient());
}

export function systemAuditRecorder() {
  return prismaAuditRecorder;
}

export function partnerConnectionRepository() {
  const db = getPrismaClient();
  const repos = createSystemRepos(db);
  return {
    async findByInboundClientId(clientId: string) {
      const row = await repos.findConnectionByInboundClientId(clientId);
      if (!row) return null;
      return {
        id: row.id,
        partnerId: row.partnerId,
        partnerCode: row.partnerCode,
        partnerStatus: row.partnerStatus,
        inboundClientId: row.inboundClientId,
        allowedInboundScope: row.allowedInboundScope,
        status: row.status,
      };
    },
  };
}

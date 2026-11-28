// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ActorResolver } from "../platform/workflow/approval-request";
import { createTradingRepos } from "../contexts/trading/infrastructure/prisma-repos";

export const applyApprovalResult = (tx: Prisma.TransactionClient, documentId: string,
  result: "approved" | "rejected") => createTradingRepos(tx).applyApprovalResult(documentId, result);

export function membershipActorResolver(db: PrismaClient): ActorResolver {
  return async (sub) => {
    const membership = await db.membership.findUnique({
      where: { keycloakSub: sub },
      include: {
        warehouses: { select: { warehouseId: true } },
        roles: { select: { role: true } },
      },
    });
    if (!membership) return null;
    const roles = membership.roles.map((r) => r.role);
    return {
      sub,
      roles: roles.length > 0 ? roles : [membership.role],
      active: membership.status === "active",
      warehouseIds: membership.warehouses.map((w) => w.warehouseId),
    };
  };
}

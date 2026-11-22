// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { ActorResolver } from "../platform/workflow/approval-request";

export function membershipActorResolver(db: PrismaClient): ActorResolver {
  return async (sub) => {
    const membership = await db.membership.findUnique({
      where: { keycloakSub: sub },
      include: { warehouses: { select: { warehouseId: true } } },
    });
    if (!membership) return null;
    return {
      sub,
      role: membership.role,
      active: membership.status === "active",
      warehouseIds: membership.warehouses.map((w) => w.warehouseId),
    };
  };
}

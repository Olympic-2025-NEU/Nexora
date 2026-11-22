// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { checkPolicy, requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createSystemRepos } from "@/contexts/system/infrastructure/prisma-repos";
import {
  fail,
  mapRouteError,
  ok,
  projectMember,
} from "@/contexts/system/application/http";
import { isMembershipRole } from "@/contexts/system/domain/types";
import { resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";
import {
  assertActiveWarehouses,
  parseWarehouseIds,
} from "@/contexts/inventory/application/warehouse-scope";
import { DomainError } from "@/platform/kernel/errors";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "admin:membership:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const role = request.nextUrl.searchParams.get("role") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    if (role && !isMembershipRole(role)) throw new DomainError("INVALID_ROLE", 422);
    const rows = await createSystemRepos(getPrismaClient()).listMemberships({
      role: role as "administrator" | "staff" | "approver" | "viewer" | undefined,
      status: status as "invited" | "active" | "disabled" | undefined,
    });
    return ok(rows.map(projectMember), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.keycloakSub !== "string" || !body.keycloakSub.trim()) {
      throw new DomainError("KEYCLOAK_SUB_REQUIRED", 422);
    }
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      throw new DomainError("DISPLAY_NAME_REQUIRED", 422);
    }
    if (typeof body.role !== "string" || !isMembershipRole(body.role)) {
      throw new DomainError("INVALID_ROLE", 422);
    }
    const warehouseIds = parseWarehouseIds(body.warehouseIds);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "admin:membership:manage",
        method: "POST",
        routeKey: "members",
        payload: { ...body, keycloakSub: "[redacted]" },
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:membership:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const existing = await repos.findMembershipBySub(String(body.keycloakSub).trim());
          if (existing) throw new DomainError("MEMBERSHIP_EXISTS", 409);
          const created = await repos.createMembership({
            id: randomUUID(),
            organizationId: ctx.tenantId,
            keycloakSub: String(body.keycloakSub).trim(),
            displayName: String(body.displayName).trim(),
            email: typeof body.email === "string" ? body.email : null,
            role: body.role as "administrator" | "staff" | "approver" | "viewer",
            status: "invited",
          });
          await assertActiveWarehouses(ctx.tx, warehouseIds);
          const scope = await createInventoryRepos(ctx.tx).replaceMembershipWarehouses(
            created.id,
            warehouseIds,
          );
          await systemAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown" },
            action: "membership.invite",
            targetType: "membership",
            targetId: created.id,
            requestId: ctx.requestId,
            after: {
              status: created.status,
              role: created.role,
              version: created.version,
              warehouseIds: scope,
              warehouseCount: scope.length,
              changedFields: ["role", "status", "version", "warehouseIds"],
            },
          });
          return { ...created, warehouseIds: scope };
        },
      },
    );
    return ok(projectMember(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

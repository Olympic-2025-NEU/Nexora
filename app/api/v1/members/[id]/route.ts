// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { createSystemRepos } from "@/contexts/system/infrastructure/prisma-repos";
import {
  mapRouteError,
  ok,
  parseIfMatchVersion,
  projectMember,
} from "@/contexts/system/application/http";
import { isMembershipRole, type MembershipRole } from "@/contexts/system/domain/types";
import { keycloakAdmin, resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";
import {
  assertActiveWarehouses,
  parseWarehouseIds,
} from "@/contexts/inventory/application/warehouse-scope";
import { DomainError } from "@/platform/kernel/errors";
import { isUuid } from "@/contexts/catalog/application/http";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  try {
    if (!isUuid(id)) throw new DomainError("MEMBER_NOT_FOUND", 404);
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "admin:membership:manage");

    const body = (await request.json()) as Record<string, unknown>;
    const warehouseIds =
      body.warehouseIds !== undefined ? parseWarehouseIds(body.warehouseIds) : undefined;
    if (body.role !== undefined && (typeof body.role !== "string" || !isMembershipRole(body.role))) {
      throw new DomainError("INVALID_ROLE", 422);
    }
    if (
      body.status !== undefined &&
      body.status !== "active" &&
      body.status !== "disabled"
    ) {
      throw new DomainError("INVALID_STATUS", 422);
    }
    if (body.displayName !== undefined && typeof body.displayName !== "string") {
      throw new DomainError("INVALID_DISPLAY_NAME", 422);
    }
    if (body.email !== undefined && body.email !== null && typeof body.email !== "string") {
      throw new DomainError("INVALID_EMAIL", 422);
    }
    const expectedVersion = parseIfMatchVersion(
      request.headers.get("if-match"),
      body.version,
    );
    if (!expectedVersion) throw new DomainError("VERSION_REQUIRED", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: async () => actor,
        resolveTenant: async (resolved) => {
          if (!("organizationId" in resolved)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return resolved.organizationId;
        },
        action: "admin:membership:manage",
        method: "PATCH",
        routeKey: `members/${id}`,
        payload: body,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:membership:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const before = await repos.findMembershipById(id);
          if (!before) throw new DomainError("MEMBER_NOT_FOUND", 404);

          const nextRole =
            typeof body.role === "string" ? (body.role as typeof before.role) : before.role;
          const nextStatus =
            typeof body.status === "string"
              ? (body.status as typeof before.status)
              : before.status;

          const demotingLastAdmin =
            before.role === "administrator" &&
            before.status === "active" &&
            (nextRole !== "administrator" || nextStatus === "disabled");
          if (demotingLastAdmin) {
            const admins = await repos.countActiveAdministrators();
            if (admins <= 1) throw new DomainError("LAST_ADMIN_PROTECTED", 409);
          }

          const updated = await repos.updateMembership(id, expectedVersion, {
            ...(body.role !== undefined
              ? { role: body.role as MembershipRole }
              : {}),
            ...(body.status !== undefined
              ? { status: body.status as "active" | "disabled" }
              : {}),
            ...(typeof body.displayName === "string"
              ? { displayName: body.displayName.trim() }
              : {}),
            ...(body.email === null || typeof body.email === "string"
              ? {
                  email:
                    body.email === null || body.email === ""
                      ? null
                      : String(body.email).trim(),
                }
              : {}),
          });
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);

          let scope = updated.warehouseIds ?? [];
          const changed: string[] = ["version"];
          if (body.role !== undefined) changed.push("role");
          if (body.status !== undefined) changed.push("status");
          if (typeof body.displayName === "string") changed.push("displayName");
          if (body.email === null || typeof body.email === "string") changed.push("email");
          if (warehouseIds !== undefined) {
            await assertActiveWarehouses(ctx.tx, warehouseIds);
            scope = await createInventoryRepos(ctx.tx).replaceMembershipWarehouses(
              id,
              warehouseIds,
            );
            changed.push("warehouseIds");
          }

          await systemAuditRecorder().record(ctx.tx, {
            actor: {
              kind: "user",
              sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
            },
            action: "membership.update",
            targetType: "membership",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: {
              role: before.role,
              status: before.status,
              version: before.version,
              warehouseIds: before.warehouseIds ?? [],
              warehouseCount: (before.warehouseIds ?? []).length,
            },
            after: {
              role: updated.role,
              status: updated.status,
              version: updated.version,
              warehouseIds: scope,
              warehouseCount: scope.length,
              changedFields: changed,
            },
          });
          return { ...updated, warehouseIds: scope };
        },
      },
    );

    // Best-effort IdP sync after DB commit (DB remains source of truth for app authz).
    const kc = keycloakAdmin();
    if (body.role !== undefined) {
      await kc.replaceRealmRoles(data.keycloakSub, data.role as MembershipRole);
    }
    if (body.status === "disabled") {
      await kc.setEnabled(data.keycloakSub, false);
    } else if (body.status === "active") {
      await kc.setEnabled(data.keycloakSub, true);
    }

    return ok(projectMember(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

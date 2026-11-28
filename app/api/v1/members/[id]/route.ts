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
import {
  expandLegacyMembershipRole,
  isMembershipRole,
  normalizeMembershipRoles,
  type MembershipRole,
} from "@/contexts/system/domain/types";
import { keycloakAdmin, resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";
import {
  assertActiveWarehouses,
  parseWarehouseIds,
} from "@/contexts/inventory/application/warehouse-scope";
import { DomainError } from "@/platform/kernel/errors";
import { isUuid } from "@/contexts/catalog/application/http";

type Params = { params: Promise<{ id: string }> };

function parseOptionalRoles(body: Record<string, unknown>): MembershipRole[] | undefined {
  if (body.roles === undefined && body.role === undefined) return undefined;
  if (Array.isArray(body.roles)) {
    const roles = normalizeMembershipRoles(
      body.roles.filter((r): r is string => typeof r === "string"),
    );
    if (roles.length === 0) throw new DomainError("INVALID_ROLE", 422);
    return roles;
  }
  if (typeof body.role === "string") {
    const expanded = expandLegacyMembershipRole(body.role);
    const roles = normalizeMembershipRoles(
      expanded.length > 0 ? expanded : [body.role],
    );
    if (roles.length === 0 || !roles.every(isMembershipRole)) {
      throw new DomainError("INVALID_ROLE", 422);
    }
    return roles;
  }
  throw new DomainError("INVALID_ROLE", 422);
}

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
    const nextRoles = parseOptionalRoles(body);
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

          const rolesAfter = nextRoles ?? before.roles;
          const nextStatus =
            typeof body.status === "string"
              ? (body.status as typeof before.status)
              : before.status;

          const wasAdmin =
            before.roles.includes("administrator") && before.status === "active";
          const staysAdmin =
            rolesAfter.includes("administrator") && nextStatus === "active";
          if (wasAdmin && !staysAdmin) {
            const admins = await repos.countActiveAdministrators();
            if (admins <= 1) throw new DomainError("LAST_ADMIN_PROTECTED", 409);
          }

          const updated = await repos.updateMembership(id, expectedVersion, {
            ...(nextRoles ? { roles: nextRoles } : {}),
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
          if (nextRoles) changed.push("roles");
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
              roles: before.roles,
              status: before.status,
              version: before.version,
              warehouseIds: before.warehouseIds ?? [],
              warehouseCount: (before.warehouseIds ?? []).length,
            },
            after: {
              role: updated.role,
              roles: updated.roles,
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

    const kc = keycloakAdmin();
    if (nextRoles) {
      await kc.replaceRealmRoles(data.keycloakSub, data.roles);
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

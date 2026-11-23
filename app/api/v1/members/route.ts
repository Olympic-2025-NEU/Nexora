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
import { keycloakAdmin, resolveUserActor, systemAuditRecorder } from "@/composition/system";
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

/**
 * Admin invite: provision (or reuse) Keycloak user by username, then insert membership.
 * Body: { username, displayName, email?, role, warehouseIds?, temporaryPassword? }
 * Do not send keycloakSub — IdP allocates / resolves the sub.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "admin:membership:manage");

    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.username !== "string" || !body.username.trim()) {
      throw new DomainError("USERNAME_REQUIRED", 422);
    }
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      throw new DomainError("DISPLAY_NAME_REQUIRED", 422);
    }
    if (typeof body.role !== "string" || !isMembershipRole(body.role)) {
      throw new DomainError("INVALID_ROLE", 422);
    }
    if (body.keycloakSub !== undefined) {
      throw new DomainError("KEYCLOAK_SUB_NOT_ALLOWED", 422);
    }
    const warehouseIds = parseWarehouseIds(body.warehouseIds);
    const username = body.username.trim();
    const displayName = body.displayName.trim();
    const email = typeof body.email === "string" ? body.email.trim() : null;
    const role = body.role as "administrator" | "staff" | "approver" | "viewer";
    const temporaryPassword =
      typeof body.temporaryPassword === "string" && body.temporaryPassword.trim()
        ? body.temporaryPassword.trim()
        : undefined;

    // External IdP I/O stays outside the DB transaction.
    const provisioned = await keycloakAdmin().provisionUser({
      username,
      displayName,
      email,
      role,
      temporaryPassword,
    });

    const data = await runCommand(
      { requestId },
      {
        authenticate: async () => actor,
        resolveTenant: async (resolved) => {
          if (!("organizationId" in resolved)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return resolved.organizationId;
        },
        action: "admin:membership:manage",
        method: "POST",
        routeKey: "members",
        payload: {
          username,
          displayName,
          role,
          email: email ? "[redacted]" : null,
          keycloakSub: "[redacted]",
          keycloakCreated: provisioned.created,
        },
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:membership:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const existing = await repos.findMembershipBySub(provisioned.keycloakSub);
          if (existing) throw new DomainError("MEMBERSHIP_EXISTS", 409);
          const created = await repos.createMembership({
            id: randomUUID(),
            organizationId: ctx.tenantId,
            keycloakSub: provisioned.keycloakSub,
            displayName,
            email,
            role,
            status: "active",
          });
          await assertActiveWarehouses(ctx.tx, warehouseIds);
          const scope = await createInventoryRepos(ctx.tx).replaceMembershipWarehouses(
            created.id,
            warehouseIds,
          );
          await systemAuditRecorder().record(ctx.tx, {
            actor: {
              kind: "user",
              sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
            },
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
              keycloakCreated: provisioned.created,
              changedFields: ["role", "status", "version", "warehouseIds"],
            },
          });
          return { ...created, warehouseIds: scope };
        },
      },
    );

    return ok(
      {
        ...projectMember(data),
        ...(provisioned.provisionalPassword
          ? { provisionalPassword: provisioned.provisionalPassword }
          : {}),
        keycloakCreated: provisioned.created,
      },
      requestId,
      201,
    );
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

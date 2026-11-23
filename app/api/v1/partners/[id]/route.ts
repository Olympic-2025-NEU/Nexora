// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { createSystemRepos } from "@/contexts/system/infrastructure/prisma-repos";
import {
  mapRouteError,
  ok,
  parseIfMatchVersion,
  projectPartner,
} from "@/contexts/system/application/http";
import { resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { DomainError } from "@/platform/kernel/errors";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      body.status !== undefined &&
      body.status !== "active" &&
      body.status !== "suspended"
    ) {
      throw new DomainError("INVALID_STATUS", 422);
    }
    const expectedVersion = parseIfMatchVersion(
      request.headers.get("if-match"),
      body.version,
    );
    if (!expectedVersion) throw new DomainError("VERSION_REQUIRED", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "admin:partner:manage",
        method: "PATCH",
        routeKey: `partners/${id}`,
        payload: body,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:partner:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const before = await repos.findPartnerById(id);
          if (!before) throw new DomainError("PARTNER_NOT_FOUND", 404);
          const updated = await repos.updatePartner(id, expectedVersion, {
            ...(typeof body.displayName === "string" ? { displayName: body.displayName.trim() } : {}),
            ...(body.status === "active" || body.status === "suspended"
              ? { status: body.status }
              : {}),
            ...(body.contactEmail === null || typeof body.contactEmail === "string"
              ? { contactEmail: body.contactEmail as string | null }
              : {}),
          });
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
          await systemAuditRecorder().record(ctx.tx, {
            actor: {
              kind: "user",
              sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
            },
            action: body.status === "suspended" ? "partner.suspend" : "partner.update",
            targetType: "partner",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: { status: before.status, version: before.version },
            after: {
              status: updated.status,
              version: updated.version,
              changedFields: ["status", "version"],
            },
          });
          return updated;
        },
      },
    );
    return ok(projectPartner(data, true), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

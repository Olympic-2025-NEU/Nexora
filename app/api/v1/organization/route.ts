// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy, requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createSystemRepos } from "@/contexts/system/infrastructure/prisma-repos";
import {
  fail,
  mapRouteError,
  ok,
  parseIfMatchVersion,
  projectOrganization,
} from "@/contexts/system/application/http";
import { resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { DomainError } from "@/platform/kernel/errors";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "admin:organization:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const org = await createSystemRepos(getPrismaClient()).getOrganization();
    if (!org) return fail("ORGANIZATION_NOT_FOUND", 404, requestId);
    return ok(projectOrganization(org), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const allowedKeys = new Set([
      "name",
      "contactEmail",
      "contactPhone",
      "address",
      "timezone",
      "version",
    ]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) throw new DomainError("FIELD_NOT_ALLOWED", 422);
    }
    if (
      !body.name &&
      body.contactEmail === undefined &&
      body.contactPhone === undefined &&
      body.address === undefined &&
      !body.timezone
    ) {
      throw new DomainError("EMPTY_PATCH", 422);
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
        action: "admin:organization:manage",
        method: "PATCH",
        routeKey: "organization",
        payload: body,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:organization:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const before = await repos.getOrganization();
          if (!before) throw new DomainError("ORGANIZATION_NOT_FOUND", 404);

          const patch: {
            expectedVersion: number;
            name?: string;
            contactEmail?: string | null;
            contactPhone?: string | null;
            address?: string | null;
            timezone?: string;
          } = { expectedVersion };
          const changedFields: string[] = ["version"];

          if (typeof body.name === "string") {
            patch.name = body.name.trim();
            changedFields.push("name");
          }
          if (body.contactEmail === null || typeof body.contactEmail === "string") {
            patch.contactEmail =
              body.contactEmail === null || body.contactEmail === ""
                ? null
                : String(body.contactEmail).trim();
            changedFields.push("contactEmail");
          }
          if (body.contactPhone === null || typeof body.contactPhone === "string") {
            patch.contactPhone =
              body.contactPhone === null || body.contactPhone === ""
                ? null
                : String(body.contactPhone).trim();
            changedFields.push("contactPhone");
          }
          if (body.address === null || typeof body.address === "string") {
            patch.address =
              body.address === null || body.address === ""
                ? null
                : String(body.address).trim();
            changedFields.push("address");
          }
          if (typeof body.timezone === "string") {
            patch.timezone = body.timezone;
            changedFields.push("timezone");
          }

          const updated = await repos.updateOrganization(patch);
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
          await systemAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown" },
            action: "organization.update",
            targetType: "organization",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: { version: before.version, status: before.status },
            after: { version: updated.version, status: updated.status, changedFields },
          });
          return updated;
        },
      },
    );
    return ok(projectOrganization(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

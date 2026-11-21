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
  projectPartner,
} from "@/contexts/system/application/http";
import { resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { DomainError } from "@/platform/kernel/errors";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "admin:partner:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const includeContact = actor.roles.includes("administrator");
    const rows = await createSystemRepos(getPrismaClient()).listPartners();
    return ok(
      rows.map((row) => projectPartner(row, includeContact)),
      requestId,
    );
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    for (const key of ["issuerInstanceId", "code", "displayName"] as const) {
      if (typeof body[key] !== "string" || !String(body[key]).trim()) {
        throw new DomainError(`${key.toUpperCase()}_REQUIRED`, 422);
      }
    }

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "admin:partner:manage",
        method: "POST",
        routeKey: "partners",
        payload: body,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:partner:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          try {
            const created = await repos.createPartner({
              id: randomUUID(),
              issuerInstanceId: String(body.issuerInstanceId).trim(),
              code: String(body.code).trim(),
              displayName: String(body.displayName).trim(),
              contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : null,
              createdBySub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
            });
            await systemAuditRecorder().record(ctx.tx, {
              actor: {
                kind: "user",
                sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
              },
              action: "partner.create",
              targetType: "partner",
              targetId: created.id,
              requestId: ctx.requestId,
              after: { status: created.status, version: created.version },
            });
            return created;
          } catch (err) {
            if (err instanceof Error && /Unique constraint|unique/i.test(err.message)) {
              throw new DomainError("PARTNER_ISSUER_OR_CODE_CONFLICT", 409);
            }
            throw err;
          }
        },
      },
    );
    return ok(projectPartner(data, true), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

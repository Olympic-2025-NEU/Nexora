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
  projectConnectionView,
} from "@/contexts/system/application/http";
import { resolveUserActor, systemAuditRecorder } from "@/composition/system";
import { DomainError } from "@/platform/kernel/errors";
import { validatePartnerUrl } from "@/platform/security/ssrf";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  const { id } = await context.params;
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "admin:partner:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const repos = createSystemRepos(getPrismaClient());
    const partner = await repos.findPartnerById(id);
    if (!partner) return fail("PARTNER_NOT_FOUND", 404, requestId);
    const conn = await repos.findConnectionByPartnerId(id);
    if (!conn) return fail("CONNECTION_NOT_FOUND", 404, requestId);
    return ok(projectConnectionView(conn), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function PUT(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const required = [
      "endpointUrl",
      "outboundTokenUrl",
      "outboundClientId",
      "outboundSecretRef",
      "outboundAudience",
      "inboundClientId",
      "allowedInboundScope",
    ] as const;
    for (const key of required) {
      if (typeof body[key] !== "string" || !String(body[key]).trim()) {
        throw new DomainError(`${key.toUpperCase()}_REQUIRED`, 422);
      }
    }

    validatePartnerUrl(String(body.endpointUrl));
    validatePartnerUrl(String(body.outboundTokenUrl));

    // Never accept plaintext secret masquerading as a value that looks like a bearer token.
    const secretRef = String(body.outboundSecretRef).trim();
    if (/^Bearer\s+/i.test(secretRef) || secretRef.split(".").length === 3) {
      throw new DomainError("SECRET_MUST_BE_REFERENCE", 422);
    }

    const status =
      body.status === "disabled" || body.status === "rotating" || body.status === "active"
        ? body.status
        : "active";

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "admin:partner:connection:manage",
        method: "PUT",
        routeKey: `partners/${id}/connection`,
        payload: { ...body, outboundSecretRef: "[redacted-ref]" },
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "admin:partner:connection:manage",
          );
          const repos = createSystemRepos(ctx.tx);
          const partner = await repos.findPartnerById(id);
          if (!partner) throw new DomainError("PARTNER_NOT_FOUND", 404);
          if (partner.status !== "active") {
            throw new DomainError("PARTNER_SUSPENDED", 409);
          }
          const before = await repos.findConnectionByPartnerId(id);
          const saved = await repos.upsertConnection({
            id: before?.id ?? randomUUID(),
            partnerId: id,
            endpointUrl: String(body.endpointUrl).trim(),
            outboundTokenUrl: String(body.outboundTokenUrl).trim(),
            outboundClientId: String(body.outboundClientId).trim(),
            outboundSecretRef: secretRef,
            outboundAudience: String(body.outboundAudience).trim(),
            inboundClientId: String(body.inboundClientId).trim(),
            allowedInboundScope: String(body.allowedInboundScope).trim(),
            status,
            rotatedAt: before ? new Date() : null,
          });
          await systemAuditRecorder().record(ctx.tx, {
            actor: {
              kind: "user",
              sub: "organizationId" in ctx.actor ? ctx.actor.userId : "unknown",
            },
            action: before ? "partner.connection.rotate" : "partner.connection.upsert",
            targetType: "partner_connection",
            targetId: saved.id,
            requestId: ctx.requestId,
            before: before
              ? { status: before.status, version: before.version, connectionStatus: before.status }
              : undefined,
            after: {
              status: saved.status,
              version: saved.version,
              connectionStatus: saved.status,
              changedFields: ["connectionStatus", "version"],
            },
          });
          return saved;
        },
      },
    );
    return ok(projectConnectionView(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

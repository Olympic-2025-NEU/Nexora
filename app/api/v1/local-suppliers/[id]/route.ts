// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy, requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import {
  assertBody,
  isUuid,
  mapRouteError,
  ok,
  parseIfMatchVersion,
  readJson,
} from "@/contexts/catalog/application/http";
import { createLocalSupplierService } from "@/contexts/trading/application/local-suppliers";
import { resolveUserActor } from "@/composition/system";
import { tradingUnitOfWork } from "@/composition/trading";
import { getPrismaClient } from "@/platform/persistence/prisma";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("LOCAL_SUPPLIER_ID_INVALID", 422);
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "trading:local-supplier:read").allowed) {
      throw new DomainError("POLICY_DENIED", 403);
    }
    const data = await createLocalSupplierService().view(
      { tx: getPrismaClient(), actor, requestId },
      id,
    );
    return ok(data, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("LOCAL_SUPPLIER_ID_INVALID", 422);
    const version = parseIfMatchVersion(request.headers.get("if-match"));
    if (version === null) throw new DomainError("IF_MATCH_REQUIRED", 428);
    const body = assertBody(await readJson(request), [
      "displayName", "status", "contactPhone", "contactEmail", "note",
    ]);
    const result = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "trading:local-supplier:manage",
        method: "PATCH",
        routeKey: `local-suppliers:${id}`,
        payload: body,
        unitOfWork: tradingUnitOfWork,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "trading:local-supplier:manage",
          );
          return createLocalSupplierService().update(
            { tx: ctx.tx, actor: ctx.actor as never, requestId },
            id,
            version,
            {
              ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
              ...(typeof body.status === "string" ? { status: body.status } : {}),
              ...(body.contactPhone !== undefined
                ? { contactPhone: typeof body.contactPhone === "string" ? body.contactPhone : null }
                : {}),
              ...(body.contactEmail !== undefined
                ? { contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : null }
                : {}),
              ...(body.note !== undefined
                ? { note: typeof body.note === "string" ? body.note : null }
                : {}),
            },
          );
        },
      },
    );
    return ok(result, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

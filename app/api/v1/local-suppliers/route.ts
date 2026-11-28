// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPolicy, requirePolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { mapRouteError, ok, readJson, assertBody } from "@/contexts/catalog/application/http";
import { createLocalSupplierService } from "@/contexts/trading/application/local-suppliers";
import { resolveUserActor } from "@/composition/system";
import { tradingUnitOfWork } from "@/composition/trading";
import { getPrismaClient } from "@/platform/persistence/prisma";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "trading:local-supplier:read").allowed) {
      throw new DomainError("POLICY_DENIED", 403);
    }
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const service = createLocalSupplierService();
    const items = await service.list(
      { tx: getPrismaClient(), actor, requestId },
      { q, status },
    );
    return NextResponse.json({ data: items, requestId });
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = assertBody(await readJson(request), [
      "code", "displayName", "contactPhone", "contactEmail", "note",
    ]);
    if (typeof body.code !== "string" || typeof body.displayName !== "string") {
      throw new DomainError("FIELDS_REQUIRED", 422);
    }
    const result = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "trading:local-supplier:manage",
        method: "POST",
        routeKey: "local-suppliers",
        payload: body,
        unitOfWork: tradingUnitOfWork,
        async domain(ctx) {
          requirePolicy(
            "organizationId" in ctx.actor
              ? ctx.actor
              : { userId: "", organizationId: ctx.tenantId, roles: ["partner"], unitIds: [] },
            "trading:local-supplier:manage",
          );
          return createLocalSupplierService().create(
            { tx: ctx.tx, actor: ctx.actor as never, requestId },
            {
              code: body.code as string,
              displayName: body.displayName as string,
              contactPhone: typeof body.contactPhone === "string" ? body.contactPhone : null,
              contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : null,
              note: typeof body.note === "string" ? body.note : null,
            },
          );
        },
      },
    );
    return ok(result, requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

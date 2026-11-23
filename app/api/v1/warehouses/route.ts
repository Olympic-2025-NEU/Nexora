// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { checkPolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";
import { projectWarehouse } from "@/contexts/inventory/application/http";
import {
  assertBody,
  decodeIdCursor,
  encodeCursor,
  fail,
  mapRouteError,
  ok,
  okList,
  parsePage,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { inventoryAuditRecorder, inventoryRepos, warehouseScope } from "@/composition/inventory";
import { resolveUserActor } from "@/composition/system";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "inventory:warehouse:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    const { limit, cursor } = parsePage(params);
    const status = params.get("status");
    if (status !== null && status !== "active" && status !== "archived") {
      throw new DomainError("INVALID_STATUS", 422);
    }
    const scopeIds = warehouseScope(actor);
    const page = await inventoryRepos().listWarehouses({
      ...(status ? { status } : {}),
      ...(scopeIds ? { scopeIds } : {}),
      ...(cursor ? { cursorId: decodeIdCursor(cursor) } : {}),
      limit,
    });
    return okList(
      page.items.map(projectWarehouse),
      {
        limit,
        nextCursor: page.nextCursorId ? encodeCursor(page.nextCursorId) : null,
      },
      requestId,
    );
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = assertBody(await readJson(request), ["code", "name"]);
    const code = requireText(body.code, "WAREHOUSE_CODE_INVALID", 40);
    const name = requireText(body.name, "NAME_INVALID", 160);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "inventory:warehouse:manage",
        method: "POST",
        routeKey: "warehouses",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createInventoryRepos(ctx.tx);
          let created;
          try {
            created = await repos.createWarehouse({
              id: randomUUID(),
              code,
              name,
              createdBySub: sub,
            });
          } catch (err) {
            if (err instanceof Error && /Unique constraint/i.test(err.message)) {
              throw new DomainError("WAREHOUSE_CODE_CONFLICT", 409);
            }
            throw err;
          }
          await inventoryAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: "warehouse.create",
            targetType: "warehouse",
            targetId: created.id,
            requestId: ctx.requestId,
            after: { status: created.status, version: created.version },
          });
          return created;
        },
      },
    );
    return ok(projectWarehouse(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

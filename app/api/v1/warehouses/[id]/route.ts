// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createInventoryRepos } from "@/contexts/inventory/infrastructure/prisma-repos";
import { projectWarehouse } from "@/contexts/inventory/application/http";
import {
  assertBody,
  isUuid,
  mapRouteError,
  ok,
  parseIfMatchVersion,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { inventoryAuditRecorder } from "@/composition/inventory";
import { resolveUserActor } from "@/composition/system";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("WAREHOUSE_NOT_FOUND", 404);
    // code is immutable; archive is a soft state change, never a delete.
    const body = assertBody(await readJson(request), ["name", "status", "version"]);
    if (body.name === undefined && body.status === undefined) {
      throw new DomainError("EMPTY_PATCH", 422);
    }
    const name = body.name !== undefined ? requireText(body.name, "NAME_INVALID", 160) : undefined;
    if (body.status !== undefined && body.status !== "active" && body.status !== "archived") {
      throw new DomainError("INVALID_STATUS", 422);
    }
    const status = body.status as "active" | "archived" | undefined;
    const expectedVersion = parseIfMatchVersion(request.headers.get("if-match"), body.version);
    if (!expectedVersion) throw new DomainError("VERSION_REQUIRED", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "inventory:warehouse:manage",
        method: "PATCH",
        routeKey: `warehouses/${id}`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createInventoryRepos(ctx.tx);
          const before = await repos.findWarehouseById(id);
          if (!before) throw new DomainError("WAREHOUSE_NOT_FOUND", 404);
          if (status === "archived" && before.status !== "archived") {
            if (await repos.hasPositiveBalance(id)) {
              throw new DomainError("WAREHOUSE_HAS_STOCK", 409);
            }
          }
          const updated = await repos.updateWarehouse(id, expectedVersion, {
            ...(name !== undefined ? { name } : {}),
            ...(status !== undefined ? { status } : {}),
          });
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
          await inventoryAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: status === "archived" ? "warehouse.archive" : "warehouse.update",
            targetType: "warehouse",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: { status: before.status, version: before.version },
            after: { status: updated.status, version: updated.version },
          });
          return updated;
        },
      },
    );
    return ok(projectWarehouse(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

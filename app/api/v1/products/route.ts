// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { checkPolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  decodeIdCursor,
  encodeCursor,
  fail,
  mapRouteError,
  ok,
  okList,
  parsePage,
  projectProduct,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { isBaseUnit } from "@/contexts/catalog/domain/quantity";
import { catalogAuditRecorder, catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:product:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    const { limit, cursor } = parsePage(params);
    const status = params.get("status");
    if (status !== null && status !== "active" && status !== "archived") {
      throw new DomainError("INVALID_STATUS", 422);
    }
    const q = params.get("q");
    const page = await catalogRepos().listProducts({
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(cursor ? { cursorId: decodeIdCursor(cursor) } : {}),
      limit,
    });
    return okList(
      page.items.map(projectProduct),
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
    const body = assertBody(await readJson(request), ["sku", "name", "description", "baseUnit"]);
    const sku = requireText(body.sku, "SKU_INVALID", 64);
    const name = requireText(body.name, "NAME_INVALID", 200);
    if (!isBaseUnit(body.baseUnit)) throw new DomainError("BASE_UNIT_INVALID", 422);
    const baseUnit = body.baseUnit;
    if (body.description !== undefined && typeof body.description !== "string") {
      throw new DomainError("DESCRIPTION_INVALID", 422);
    }
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:create",
        method: "POST",
        routeKey: "products",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createCatalogRepos(ctx.tx);
          let created;
          try {
            created = await repos.createProduct({
              id: randomUUID(),
              sku,
              name,
              description,
              baseUnit,
              createdBySub: sub,
            });
          } catch (err) {
            if (err instanceof Error && /Unique constraint/i.test(err.message)) {
              throw new DomainError("PRODUCT_SKU_CONFLICT", 409);
            }
            throw err;
          }
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: "product.create",
            targetType: "product",
            targetId: created.id,
            requestId: ctx.requestId,
            after: { status: created.status, version: created.version },
          });
          return created;
        },
      },
    );
    return ok(projectProduct(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

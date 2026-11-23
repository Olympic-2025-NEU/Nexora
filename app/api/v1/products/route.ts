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
  isUuid,
  mapRouteError,
  ok,
  okList,
  parsePage,
  projectProduct,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
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
    const q = params.get("q");
    const isActiveRaw = params.get("isActive");
    let isActive: boolean | undefined;
    if (isActiveRaw !== null) {
      if (isActiveRaw !== "true" && isActiveRaw !== "false") {
        throw new DomainError("INVALID_IS_ACTIVE", 422);
      }
      isActive = isActiveRaw === "true";
    }
    const categoryId = params.get("categoryId");
    if (categoryId !== null && !isUuid(categoryId)) {
      throw new DomainError("CATEGORY_ID_INVALID", 422);
    }
    const includeDescendants = params.get("includeDescendants") === "1";
    let categoryIds: string[] | undefined;
    if (categoryId && includeDescendants) {
      categoryIds = await catalogRepos().categorySubtreeIds(categoryId);
    }

    const page = await catalogRepos().listProducts({
      ...(q ? { q } : {}),
      ...(isActive !== undefined ? { isActive } : { isActive: true }),
      ...(categoryIds ? { categoryIds } : categoryId ? { categoryId } : {}),
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
    const body = assertBody(await readJson(request), [
      "name",
      "categoryId",
      "attributes",
      "isActive",
      "sku",
      "barcode",
    ]);
    const name = requireText(body.name, "NAME_INVALID", 200);
    if (!isUuid(body.categoryId)) throw new DomainError("CATEGORY_ID_INVALID", 422);
    const categoryId = body.categoryId as string;
    const attributes =
      body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)
        ? (body.attributes as Record<string, unknown>)
        : {};
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

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
          const productId = randomUUID();
          const created = await repos.createProduct({
            id: productId,
            name,
            categoryId,
            attributes,
            isActive,
            createdBySub: sub,
          });
          if (sku || barcode) {
            await repos.createVariant({
              id: randomUUID(),
              productId,
              sku: sku || null,
              barcode: barcode || null,
              createdBySub: sub,
            });
          }
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: "product.create",
            targetType: "product",
            targetId: created.id,
            requestId: ctx.requestId,
            after: { isActive: created.isActive, version: created.version },
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

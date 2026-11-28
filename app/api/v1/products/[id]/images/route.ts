// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { checkPolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  fail,
  isUuid,
  mapRouteError,
  ok,
  okList,
  projectProductImage,
  readJson,
} from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:product:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    const product = await catalogRepos().findProductById(id);
    if (!product || product.deletedAt) return fail("PRODUCT_NOT_FOUND", 404, requestId);
    const items = await catalogRepos().listProductImages(id);
    return okList(items.map(projectProductImage), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id: productId } = await context.params;
    if (!isUuid(productId)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    const body = assertBody(await readJson(request), ["attachmentId", "isPrimary"]);
    if (!isUuid(body.attachmentId)) throw new DomainError("ATTACHMENT_ID_INVALID", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:manage",
        method: "POST",
        routeKey: `products/${productId}/images`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return createCatalogRepos(ctx.tx).createProductImage({
            id: randomUUID(),
            productId,
            attachmentId: body.attachmentId as string,
            isPrimary: body.isPrimary === true,
          });
        },
      },
    );
    return ok(projectProductImage(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

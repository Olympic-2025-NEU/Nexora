// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  isUuid,
  mapRouteError,
  ok,
  projectProductImage,
} from "@/contexts/catalog/application/http";
import { resolveUserActor } from "@/composition/system";

type Ctx = { params: Promise<{ id: string; imageId: string }> };

export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id: productId, imageId } = await context.params;
    if (!isUuid(productId)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    if (!isUuid(imageId)) throw new DomainError("PRODUCT_IMAGE_ID_INVALID", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:manage",
        method: "DELETE",
        routeKey: `products/${productId}/images/${imageId}`,
        payload: {},
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const deleted = await createCatalogRepos(ctx.tx).softDeleteProductImage(
            productId,
            imageId,
          );
          if (!deleted) throw new DomainError("PRODUCT_IMAGE_NOT_FOUND", 404);
          return deleted;
        },
      },
    );
    return ok(projectProductImage(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
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
  parseIfMatchVersion,
  projectProduct,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { catalogAuditRecorder, catalogRepos } from "@/composition/catalog";
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
    return ok(projectProduct(product), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    const body = assertBody(await readJson(request), [
      "name",
      "categoryId",
      "attributes",
      "isActive",
      "version",
    ]);
    const version = parseIfMatchVersion(request.headers.get("if-match"), body.version);
    if (version === null) throw new DomainError("VERSION_REQUIRED", 428);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:manage",
        method: "PATCH",
        routeKey: `products/${id}`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const repos = createCatalogRepos(ctx.tx);
          const patch: {
            name?: string;
            categoryId?: string;
            attributes?: Record<string, unknown>;
            isActive?: boolean;
          } = {};
          if (body.name !== undefined) patch.name = requireText(body.name, "NAME_INVALID", 200);
          if (body.categoryId !== undefined) {
            if (!isUuid(body.categoryId)) throw new DomainError("CATEGORY_ID_INVALID", 422);
            patch.categoryId = body.categoryId as string;
          }
          if (body.attributes !== undefined) {
            if (!body.attributes || typeof body.attributes !== "object" || Array.isArray(body.attributes)) {
              throw new DomainError("ATTRIBUTES_INVALID", 422);
            }
            patch.attributes = body.attributes as Record<string, unknown>;
          }
          if (body.isActive !== undefined) {
            if (typeof body.isActive !== "boolean") throw new DomainError("IS_ACTIVE_INVALID", 422);
            patch.isActive = body.isActive;
          }
          const updated = await repos.updateProduct(id, version, patch);
          if (!updated) throw new DomainError("PRODUCT_VERSION_CONFLICT", 409);
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub: ctx.actor.userId },
            action: "product.update",
            targetType: "product",
            targetId: id,
            requestId: ctx.requestId,
            after: { version: updated.version, isActive: updated.isActive },
          });
          return updated;
        },
      },
    );
    return ok(projectProduct(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

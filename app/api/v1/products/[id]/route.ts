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

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:product:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    if (!isUuid(id)) return fail("PRODUCT_NOT_FOUND", 404, requestId);
    const product = await catalogRepos().findProductById(id);
    if (!product) return fail("PRODUCT_NOT_FOUND", 404, requestId);
    return ok(projectProduct(product), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function PATCH(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("PRODUCT_NOT_FOUND", 404);
    // sku and baseUnit are immutable in v1: they are not in the allow-list.
    const body = assertBody(await readJson(request), ["name", "description", "status", "version"]);
    if (body.name === undefined && body.description === undefined && body.status === undefined) {
      throw new DomainError("EMPTY_PATCH", 422);
    }
    const name = body.name !== undefined ? requireText(body.name, "NAME_INVALID", 200) : undefined;
    let description: string | null | undefined;
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new DomainError("DESCRIPTION_INVALID", 422);
      }
      description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null;
    }
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
        action: "catalog:product:manage",
        method: "PATCH",
        routeKey: `products/${id}`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createCatalogRepos(ctx.tx);
          const before = await repos.findProductById(id);
          if (!before) throw new DomainError("PRODUCT_NOT_FOUND", 404);
          const updated = await repos.updateProduct(id, expectedVersion, {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(status !== undefined ? { status } : {}),
          });
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: status === "archived" ? "product.archive" : "product.update",
            targetType: "product",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: { status: before.status, version: before.version },
            after: { status: updated.status, version: updated.version },
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

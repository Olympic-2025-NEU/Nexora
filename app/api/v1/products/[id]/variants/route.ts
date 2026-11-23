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
  projectVariant,
  readJson,
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
    const items = await catalogRepos().listVariants(id);
    return okList(items.map(projectVariant), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id: productId } = await context.params;
    if (!isUuid(productId)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    const body = assertBody(await readJson(request), ["sku", "barcode", "isPrimary", "stockUomId"]);
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
    if (!sku && !barcode) throw new DomainError("VARIANT_CODE_REQUIRED", 422);
    if (body.stockUomId !== undefined && !isUuid(body.stockUomId)) {
      throw new DomainError("UOM_ID_INVALID", 422);
    }

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
        routeKey: `products/${productId}/variants`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const repos = createCatalogRepos(ctx.tx);
          const product = await repos.findProductById(productId);
          if (!product || product.deletedAt) throw new DomainError("PRODUCT_NOT_FOUND", 404);
          const created = await repos.createVariant({
            id: randomUUID(),
            productId,
            sku: sku || null,
            barcode: barcode || null,
            isPrimary: typeof body.isPrimary === "boolean" ? body.isPrimary : undefined,
            stockUomId: typeof body.stockUomId === "string" ? body.stockUomId : undefined,
            createdBySub: ctx.actor.userId,
          });
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub: ctx.actor.userId },
            action: "variant.create",
            targetType: "product_variant",
            targetId: created.id,
            requestId: ctx.requestId,
            after: { sku: created.sku, barcode: created.barcode },
          });
          return created;
        },
      },
    );
    return ok(projectVariant(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

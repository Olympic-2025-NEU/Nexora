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
  projectPriceListItem,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import type { PriceType } from "@/contexts/catalog/domain/types";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Ctx = { params: Promise<{ id: string }> };
const TYPES = new Set(["purchase", "retail", "wholesale"]);

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:price_list:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("PRICE_LIST_ID_INVALID", 422);
    const variantId = request.nextUrl.searchParams.get("productVariantId");
    if (variantId && !isUuid(variantId)) throw new DomainError("VARIANT_ID_INVALID", 422);
    const items = await catalogRepos().listPriceListItems(
      id,
      variantId ? { productVariantId: variantId } : undefined,
    );
    return okList(items.map(projectPriceListItem), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id: priceListId } = await context.params;
    if (!isUuid(priceListId)) throw new DomainError("PRICE_LIST_ID_INVALID", 422);
    const body = assertBody(await readJson(request), [
      "productVariantId",
      "uomId",
      "priceType",
      "amount",
    ]);
    if (!isUuid(body.productVariantId)) throw new DomainError("VARIANT_ID_INVALID", 422);
    if (!isUuid(body.uomId)) throw new DomainError("UOM_ID_INVALID", 422);
    const priceType = requireText(body.priceType, "PRICE_TYPE_INVALID", 32) as PriceType;
    if (!TYPES.has(priceType)) throw new DomainError("PRICE_TYPE_INVALID", 422);
    const amount = requireText(body.amount, "AMOUNT_INVALID", 40);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:price_list:manage",
        method: "POST",
        routeKey: `price-lists/${priceListId}/items`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return createCatalogRepos(ctx.tx).createPriceListItem({
            id: randomUUID(),
            priceListId,
            productVariantId: body.productVariantId as string,
            uomId: body.uomId as string,
            priceType,
            amount,
          });
        },
      },
    );
    return ok(projectPriceListItem(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

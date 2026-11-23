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
  mapRouteError,
  ok,
  okList,
  projectPriceList,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:price_list:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const items = await catalogRepos().listPriceLists();
    return okList(items.map(projectPriceList), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = assertBody(await readJson(request), [
      "code",
      "name",
      "isDefault",
      "validFrom",
      "validTo",
      "currency",
    ]);
    const name = requireText(body.name, "NAME_INVALID", 200);
    const currency = requireText(body.currency ?? "VND", "CURRENCY_INVALID", 3);
    const validFrom =
      typeof body.validFrom === "string" ? new Date(body.validFrom) : new Date();
    if (Number.isNaN(validFrom.getTime())) throw new DomainError("VALID_FROM_INVALID", 422);
    const validTo =
      body.validTo === null || body.validTo === undefined
        ? null
        : typeof body.validTo === "string"
          ? new Date(body.validTo)
          : null;
    if (validTo && Number.isNaN(validTo.getTime())) throw new DomainError("VALID_TO_INVALID", 422);

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
        routeKey: "price-lists",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return createCatalogRepos(ctx.tx).createPriceList({
            id: randomUUID(),
            code: typeof body.code === "string" ? body.code : null,
            name,
            isDefault: Boolean(body.isDefault),
            validFrom,
            validTo,
            currency,
            createdBySub: ctx.actor.userId,
          });
        },
      },
    );
    return ok(projectPriceList(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

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
  projectCategory,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:category:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const items = await catalogRepos().listCategories();
    return okList(items.map(projectCategory), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = assertBody(await readJson(request), ["code", "name", "parentId", "sortOrder"]);
    const code = requireText(body.code, "CODE_INVALID", 64);
    const name = requireText(body.name, "NAME_INVALID", 200);
    if (body.parentId !== undefined && body.parentId !== null && !isUuid(body.parentId)) {
      throw new DomainError("PARENT_ID_INVALID", 422);
    }
    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:category:manage",
        method: "POST",
        routeKey: "categories",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const repos = createCatalogRepos(ctx.tx);
          return repos.createCategory({
            id: randomUUID(),
            code,
            name,
            parentId: (body.parentId as string | null | undefined) ?? null,
            sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
            createdBySub: ctx.actor.userId,
          });
        },
      },
    );
    return ok(projectCategory(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

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
  projectUom,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import type { UomKind } from "@/contexts/catalog/domain/types";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

const KINDS = new Set(["count", "mass", "volume"]);

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:uom:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    const items = await catalogRepos().listUoms();
    return okList(items.map(projectUom), { limit: items.length }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = assertBody(await readJson(request), ["name", "kind"]);
    const name = requireText(body.name, "UOM_NAME_INVALID", 64);
    const kind = (typeof body.kind === "string" ? body.kind : "count") as UomKind;
    if (!KINDS.has(kind)) throw new DomainError("UOM_KIND_INVALID", 422);
    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:uom:manage",
        method: "POST",
        routeKey: "uoms",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return createCatalogRepos(ctx.tx).createUom({ id: randomUUID(), name, kind });
        },
      },
    );
    return ok(projectUom(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

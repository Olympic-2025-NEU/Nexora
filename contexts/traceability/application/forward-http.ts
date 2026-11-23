// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { DomainError } from "../../../platform/kernel/errors";
import { mapRouteError, ok } from "../../catalog/application/http";
import { resolveUserActor } from "../../../composition/system";
import { getPrismaClient } from "../../../platform/persistence/prisma";
import { createPrismaForwardPort } from "../infrastructure/forward-repo";
import { forwardTrace } from "./forward";

function positive(value: string | null) {
  if (value === null) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new DomainError("TRACE_QUERY_INVALID", 422);
  return Number(value);
}

export async function traceForwardRoute(request: NextRequest, batchId: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const query = request.nextUrl.searchParams;
    for (const key of query.keys()) {
      if (!["depth", "limit", "cursor"].includes(key) || query.getAll(key).length !== 1)
        throw new DomainError("TRACE_QUERY_INVALID", 422);
    }
    const result = await forwardTrace(createPrismaForwardPort(getPrismaClient(), actor), actor, {
      batchId, depth: positive(query.get("depth")), limit: positive(query.get("limit")),
      cursor: query.get("cursor"),
    });
    const response = ok(result, requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

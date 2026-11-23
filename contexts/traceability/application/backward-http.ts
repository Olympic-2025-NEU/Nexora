// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { DomainError } from "../../../platform/kernel/errors";
import { mapRouteError, ok } from "../../catalog/application/http";
import { resolveUserActor } from "../../../composition/system";
import { getPrismaClient } from "../../../platform/persistence/prisma";
import { createPrismaBackwardPort } from "../infrastructure/backward-repo";
import { backwardTrace } from "./backward";

function optionalInteger(value: string | null, code: string) {
  if (value === null) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new DomainError(code, 422);
  return Number(value);
}

export async function traceBackwardRoute(request: NextRequest, batchId: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const query = request.nextUrl.searchParams;
    for (const key of query.keys()) {
      if (!["documentId", "depth", "limit", "cursor"].includes(key) || query.getAll(key).length !== 1)
        throw new DomainError("TRACE_QUERY_INVALID", 422);
    }
    const result = await backwardTrace(createPrismaBackwardPort(getPrismaClient()), actor, {
      batchId, documentId: query.get("documentId") ?? undefined,
      depth: optionalInteger(query.get("depth"), "TRACE_QUERY_INVALID"),
      limit: optionalInteger(query.get("limit"), "TRACE_QUERY_INVALID"),
      cursor: query.get("cursor"),
    });
    const response = ok(result, requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

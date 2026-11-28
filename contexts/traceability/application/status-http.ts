// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { checkPolicy } from "@/platform/access/policy";
import { mapRouteError, ok } from "@/contexts/catalog/application/http";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { traceLag } from "../infrastructure/lag";

export async function traceStatusRoute(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (request.method !== "GET") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "trace:read").allowed) throw new DomainError("POLICY_DENIED", 403);
    const lag = await traceLag(getPrismaClient());
    const state = lag.pending === 0 ? "caught_up" : lag.seconds > 300 ? "lagging" : "pending";
    const response = ok({ state, pendingEvents: lag.pending, lagSeconds: lag.seconds,
      checkedAt: new Date().toISOString() }, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

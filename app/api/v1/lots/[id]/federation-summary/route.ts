// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { publishTraceSummary } from "@/contexts/federation/application/publish-trace-summary";
import { DomainError } from "@/platform/kernel/errors";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as { recipientInstanceId?: unknown }).recipientInstanceId !== "string")
      throw new DomainError("TRACE_SUMMARY_INVALID", 422);
    const result = await publishTraceSummary(getPrismaClient(), actor, id,
      (body as { recipientInstanceId: string }).recipientInstanceId, requestId);
    const response = ok(result, requestId, 202);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

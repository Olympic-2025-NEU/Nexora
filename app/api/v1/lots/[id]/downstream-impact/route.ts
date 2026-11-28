// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { DomainError } from "@/platform/kernel/errors";
import { publishDownstreamImpact } from "@/contexts/federation/application/publish-downstream-impact";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["recipientInstanceId", "sourceDocumentId",
          "sourceInboxMessageId"].includes(key)) ||
        typeof (body as { recipientInstanceId?: unknown }).recipientInstanceId !== "string" ||
        typeof (body as { sourceDocumentId?: unknown }).sourceDocumentId !== "string" ||
        (Object.hasOwn(body, "sourceInboxMessageId") &&
          typeof (body as { sourceInboxMessageId?: unknown }).sourceInboxMessageId !== "string"))
      throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422);
    const input = body as { recipientInstanceId: string; sourceDocumentId: string;
      sourceInboxMessageId?: string };
    const result = await publishDownstreamImpact(getPrismaClient(), actor, id,
      input.recipientInstanceId, input.sourceDocumentId, input.sourceInboxMessageId, requestId);
    const response = ok(result, requestId, 202);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

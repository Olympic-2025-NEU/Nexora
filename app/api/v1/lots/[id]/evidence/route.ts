// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { assertBody, mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { createTraceEvidenceService } from "@/contexts/traceability/application/evidence-service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const response = ok(await createTraceEvidenceService(getPrismaClient()).list(actor, id), requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}
export async function POST(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const body = assertBody(await readJson(request), ["eventId", "attachmentId", "visibility"]);
    const result = await createTraceEvidenceService(getPrismaClient())
      .attach(actor, id, body.eventId as string, body.attachmentId as string,
        body.visibility as string, requestId);
    const response = ok(result, requestId, 201);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

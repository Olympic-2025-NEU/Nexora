// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { assertBody, mapRouteError, readJson } from "@/contexts/catalog/application/http";
import { createTraceEvidenceService } from "@/contexts/traceability/application/evidence-service";

export async function POST(request: NextRequest, context: {
  params: Promise<{ id: string; evidenceId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id, evidenceId } = await context.params;
    const body = assertBody(await readJson(request), ["reason"]);
    await createTraceEvidenceService(getPrismaClient()).revoke(actor, id, evidenceId,
      body.reason as string, requestId);
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return mapRouteError(error, requestId); }
}

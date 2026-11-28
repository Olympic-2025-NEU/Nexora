// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { assertBody, mapRouteError, readJson } from "@/contexts/catalog/application/http";
import { createQrService } from "@/contexts/traceability/application/qr-token";

export async function POST(request: NextRequest,
  context: { params: Promise<{ id: string; tokenId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id, tokenId } = await context.params;
    const body = assertBody(await readJson(request), ["reason"]);
    await createQrService(getPrismaClient()).revoke(actor, id, tokenId,
      body.reason as string, requestId);
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store",
      "x-request-id": requestId } });
  } catch (error) { return mapRouteError(error, requestId); }
}

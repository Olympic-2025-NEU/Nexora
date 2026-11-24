// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { assertBody, mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { createQrService } from "@/contexts/traceability/application/qr-token";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const body = assertBody(await readJson(request), ["policyVersion"]);
    const issued = await createQrService(getPrismaClient(), process.env.PUBLIC_BASE_URL)
      .issue(actor, id, body.policyVersion as string,
        request.headers.get("idempotency-key") ?? "", requestId);
    const response = ok(issued, requestId, 201);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

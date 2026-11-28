// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { DomainError } from "@/platform/kernel/errors";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { assertBody, mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { createPassportService } from "@/contexts/traceability/application/passport-service";

type Context = { params: Promise<{ id: string; action: string }> };

export async function POST(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id, action } = await context.params;
    const service = createPassportService(getPrismaClient());
    let result: unknown;
    if (action === "approve") {
      const body = assertBody(await readJson(request), ["version"]);
      result = await service.approve(actor, id, body.version as number, requestId);
    } else if (action === "revoke") {
      const body = assertBody(await readJson(request), ["reason"]);
      if (typeof body.reason !== "string") throw new DomainError("REASON_REQUIRED", 422);
      result = await service.revoke(actor, id, body.reason, requestId);
    } else if (action === "rebuild") {
      if (request.headers.get("content-length") && request.headers.get("content-length") !== "0")
        throw new DomainError("BODY_INVALID", 422);
      result = await service.rebuild(actor, id, requestId);
    } else throw new DomainError("PASSPORT_ACTION_NOT_FOUND", 404);
    const response = ok(result, requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

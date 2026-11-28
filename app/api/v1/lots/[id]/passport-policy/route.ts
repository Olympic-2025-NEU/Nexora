// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { createPassportService } from "@/contexts/traceability/application/passport-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const response = ok(await createPassportService(getPrismaClient()).read(actor, id), requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

export async function POST(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { id } = await context.params;
    const policy = await createPassportService(getPrismaClient())
      .createDraft(actor, id, await readJson(request), requestId);
    const response = ok(policy, requestId, 201);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return mapRouteError(error, requestId); }
}

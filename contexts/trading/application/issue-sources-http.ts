// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPrismaClient } from "../../../platform/persistence/prisma";
import { mapRouteError } from "../../catalog/application/http";
import { resolveUserActor } from "../../../composition/system";
import { listIssueSources } from "./issue-sources";

export async function issueSourcesRoute(request: NextRequest, batchId: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const result = await listIssueSources(getPrismaClient(), actor, batchId,
      request.nextUrl.searchParams.get("warehouseId") ?? "",
      request.nextUrl.searchParams.get("cursor") ?? undefined,
      rawLimit === null ? 20 : Number(rawLimit));
    return NextResponse.json({ data: result.items, page: { nextCursor: result.nextCursor }, requestId },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return mapRouteError(error, requestId); }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import {
  fail,
  isUuid,
  mapRouteError,
  ok,
  projectBatch,
} from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:batch:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);
    if (!isUuid(id)) return fail("BATCH_NOT_FOUND", 404, requestId);
    const batch = await catalogRepos().findBatchById(id);
    if (!batch) return fail("BATCH_NOT_FOUND", 404, requestId);
    return ok(projectBatch(batch), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

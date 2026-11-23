// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { approvalInbox } from "@/composition/approvals";
import { requirePolicy } from "@/platform/access/policy";
import { mapRouteError, ok } from "@/contexts/catalog/application/http";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "workflow:approval:read");
    return ok(await approvalInbox(actor), requestId);
  } catch (error) { return mapRouteError(error, requestId); }
}

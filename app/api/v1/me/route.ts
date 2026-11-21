// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/me — authenticated actor projection (membership DB authoritative).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/platform/identity/request-auth";
import { checkPolicy } from "@/platform/access/policy";
import { resolveUserActor } from "@/composition/system";
import { mapRouteError } from "@/contexts/system/application/http";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "platform:me:read");
    if (!allowed) return authErrorResponse("POLICY_DENIED", 403, requestId);
    return NextResponse.json(
      {
        userId: actor.userId,
        organizationId: actor.organizationId,
        roles: actor.roles,
        unitIds: actor.unitIds,
      },
      { status: 200 },
    );
  } catch (err) {
    return mapRouteError(err, requestId) as NextResponse;
  }
}

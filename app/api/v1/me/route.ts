// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/me — returns the authenticated actor's safe projection.
 *
 * This route is intentionally thin: it demonstrates bearer enforcement and
 * policy application without exposing any secrets or internal DB IDs beyond
 * what the token already carries.
 *
 * Authentication: Bearer JWT verified via JWKS + membership DB lookup.
 * Policy: any active membership role may call this endpoint (all roles).
 * No secrets (tokens, hashes, internal keys) are returned.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticate, authErrorResponse, AuthError } from "@/platform/identity/request-auth";
import { TokenError } from "@/platform/identity/token";
import { ActorResolutionError } from "@/platform/identity/resolve-actor";
import { checkPolicy } from "@/platform/access/policy";
import { getPrismaClient } from "@/platform/persistence/prisma";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");

  // Build membership repo from Prisma (lazy — only used when request arrives).
  const prisma = getPrismaClient();
  const membershipRepo = {
    async findBySub(sub: string) {
      const row = await prisma.membership.findUnique({ where: { keycloakSub: sub } });
      if (!row) return null;
      return {
        ...row,
        role: row.role as "administrator" | "staff" | "approver" | "viewer",
        status: row.status as "invited" | "active" | "disabled",
      };
    },
  };

  let actor;
  try {
    actor = await authenticate(request, { membershipRepo });
  } catch (err) {
    if (err instanceof TokenError || err instanceof AuthError || err instanceof ActorResolutionError) {
      const status = (err as { httpStatus?: number }).httpStatus === 403 ? 403 : 401;
      return authErrorResponse(
        (err as { code: string }).code,
        status as 401 | 403,
        requestId,
      );
    }
    // Unexpected error — 500 without leaking internals.
    console.error("[GET /api/v1/me] unexpected error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR", status: 500 }, { status: 500 });
  }

  // Apply policy: all roles allowed; function is a guard for future restrictions.
  const { allowed } = checkPolicy(actor, "platform:me:read");
  if (!allowed) {
    return authErrorResponse("POLICY_DENIED", 403, requestId);
  }

  // Safe projection — no token values, no internal secrets.
  return NextResponse.json(
    {
      userId: actor.userId,
      organizationId: actor.organizationId,
      roles: actor.roles,
      unitIds: actor.unitIds,
    },
    { status: 200 },
  );
}

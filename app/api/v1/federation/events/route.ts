// SPDX-License-Identifier: AGPL-3.0-only
/**
 * POST /api/v1/federation/events
 *
 * M2M federation event receiver.
 * Accepts inbound federation events from partner instances.
 *
 * Authentication: Bearer JWT from partner's Keycloak service account.
 *   - Gateway validates token (issuer/audience/expiry/signature).
 *   - App layer resolves PartnerActor (client_id → PartnerConnection DB).
 *   - Required scope: federation:write.
 *
 * NOTE: This is a stub — inbox persistence is deferred to P09.
 *       Returns 202 Accepted after partner-actor resolution succeeds.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBearerToken, TokenError } from "@/platform/identity/token";
import { resolvePartnerActor, PartnerActorError } from "@/platform/identity/partner-actor";
import { getPrismaClient } from "@/platform/persistence/prisma";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");

  // Build partner connection repo from Prisma.
  const prisma = getPrismaClient();
  // Prisma accessor uses camelCase model name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const connectionRepo = {
    async findByInboundClientId(clientId: string) {
      const conn = await prismaAny.partnerConnection.findUnique({
        where: { inboundClientId: clientId },
        include: { partner: { select: { id: true, code: true } } },
      });
      if (!conn) return null;
      return {
        id: conn.id as string,
        partnerId: conn.partnerId as string,
        partnerCode: (conn.partner as { code: string }).code,
        inboundClientId: conn.inboundClientId as string,
        allowedInboundScope: conn.allowedInboundScope as string,
        status: conn.status as "active" | "rotating" | "disabled",
      };
    },
  };

  // 1. Verify bearer token.
  const tokenOptions = {
    jwksUri: process.env.OIDC_JWKS_URL ?? process.env.OIDC_JWKS_URI ?? "",
    issuer: process.env.OIDC_ISSUER_URL ?? "",
    audience: process.env.OIDC_AUDIENCE ?? "",
  };

  let claims;
  try {
    claims = await verifyBearerToken(request.headers.get("authorization"), tokenOptions);
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "AUTH_FAILED" }, { status: 401 });
  }

  // 2. Resolve partner actor.
  let _partnerActor;
  try {
    _partnerActor = await resolvePartnerActor(
      claims as Parameters<typeof resolvePartnerActor>[0],
      connectionRepo,
    );
  } catch (err) {
    if (err instanceof PartnerActorError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "PARTNER_RESOLVE_FAILED" }, { status: 403 });
  }

  // 3. Stub: return 202 without inbox insert (P09).
  // TODO (P09): Parse event envelope, validate schema, insert into platform.outbox_message.
  return NextResponse.json(
    { status: "accepted", message: "Event received. Inbox processing deferred to P09." },
    {
      status: 202,
      headers: requestId ? { "x-request-id": requestId } : {},
    },
  );
}

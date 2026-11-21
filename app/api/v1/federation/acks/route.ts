// SPDX-License-Identifier: AGPL-3.0-only
/**
 * POST /api/v1/federation/acks — M2M ACK stub (inbox = P09).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBearerToken, TokenError } from "@/platform/identity/token";
import { resolvePartnerActor, PartnerActorError } from "@/platform/identity/partner-actor";
import { partnerConnectionRepository } from "@/composition/system";
import { redact } from "@/platform/audit/security-audit";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");
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

  try {
    await resolvePartnerActor(
      claims as Parameters<typeof resolvePartnerActor>[0],
      partnerConnectionRepository(),
    );
  } catch (err) {
    if (err instanceof PartnerActorError) {
      console.info("[federation/acks]", redact(JSON.stringify({ error: err.code, requestId })));
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "PARTNER_RESOLVE_FAILED" }, { status: 403 });
  }

  return NextResponse.json(
    { status: "accepted", message: "ACK received. Inbox processing deferred to P09." },
    { status: 202, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

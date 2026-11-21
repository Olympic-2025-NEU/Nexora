// SPDX-License-Identifier: AGPL-3.0-only
/**
 * POST /api/v1/federation/events — M2M receiver stub (inbox = P09).
 * Authz hardened in P05: client_id → active connection + active partner.
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

  // Discard self-declared issuer if present — never trust for authorization.
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "issuerInstanceId" in body) {
      void (body as { issuerInstanceId?: unknown }).issuerInstanceId;
    }
  } catch {
    // body optional for stub
  }

  try {
    await resolvePartnerActor(
      claims as Parameters<typeof resolvePartnerActor>[0],
      partnerConnectionRepository(),
    );
  } catch (err) {
    if (err instanceof PartnerActorError) {
      console.info("[federation/events]", redact(JSON.stringify({ error: err.code, requestId })));
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "PARTNER_RESOLVE_FAILED" }, { status: 403 });
  }

  return NextResponse.json(
    { status: "accepted", message: "Event received. Inbox processing deferred to P09." },
    { status: 202, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

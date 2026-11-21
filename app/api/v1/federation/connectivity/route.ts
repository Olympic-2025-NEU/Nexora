// SPDX-License-Identifier: AGPL-3.0-only
/**
 * POST /api/v1/federation/connectivity — M2M connectivity probe (not inbox).
 * Confirms partner auth without persisting events (P09 owns inbox).
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

  // Ignore self-declared issuer in body — only verified client_id mapping counts.
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && "issuerInstanceId" in body) {
      // Explicitly discarded; never used for trust.
      void body.issuerInstanceId;
    }
  } catch {
    // empty body ok
  }

  try {
    const actor = await resolvePartnerActor(
      claims as Parameters<typeof resolvePartnerActor>[0],
      partnerConnectionRepository(),
    );
    return NextResponse.json(
      {
        status: "ok",
        partnerCode: actor.partnerCode,
        message: "Connectivity probe succeeded; inbox path is separate (P09).",
      },
      { status: 200, headers: requestId ? { "x-request-id": requestId } : {} },
    );
  } catch (err) {
    if (err instanceof PartnerActorError) {
      console.info(
        "[federation/connectivity]",
        redact(JSON.stringify({ error: err.code, requestId })),
      );
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "PARTNER_RESOLVE_FAILED" }, { status: 403 });
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HTTP request authentication middleware helpers.
 *
 * Extracts Bearer tokens from incoming Next.js route handler requests,
 * verifies them via JWKS, and resolves the Actor from the membership DB.
 *
 * SECURITY: This module also hard-rejects any forged identity headers
 * (X-Userinfo, X-Authenticated-User, etc.) that a client might inject
 * when calling the app server directly — the gateway strips them, but app
 * defence-in-depth must not trust them either.
 *
 * Usage in a route handler:
 *   const actor = await authenticate(request);  // throws on failure
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBearerToken, type TokenVerifyOptions } from "./token";
import { resolveActor, type MembershipRepository } from "./resolve-actor";
import type { Actor } from "./actor";
import { TokenError } from "./token";
import { ActorResolutionError } from "./resolve-actor";

// ---------------------------------------------------------------------------
// Forged-header guard
// ---------------------------------------------------------------------------

/**
 * Headers that the APISIX gateway sets after verification.
 * The app MUST NOT read them from untrusted client requests — only from
 * requests that have already passed through the gateway OIDC plugin.
 *
 * These are stripped by the gateway serverless-pre-function; the app layer
 * also rejects them when called directly (defence-in-depth).
 */
const IDENTITY_HEADERS = [
  "x-userinfo",
  "x-access-token",
  "x-authenticated-user",
  "x-remote-user",
  "x-forwarded-user",
  "x-consumer-username",
  "x-consumer-id",
  "x-consumer-custom-id",
] as const;

/**
 * Check whether any forged identity headers are present on a direct request.
 * Returns the first offending header name, or null if clean.
 *
 * NOTE: In production, the gateway strips these before forwarding; this check
 * is defence-in-depth for direct-access scenarios (e.g. dev without gateway).
 */
export function detectForgedHeaders(request: NextRequest): string | null {
  for (const h of IDENTITY_HEADERS) {
    if (request.headers.get(h) !== null) return h;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth options resolved from environment
// ---------------------------------------------------------------------------

export interface AuthOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
}

/**
 * Load auth options from environment variables.
 * Throws if any required variable is absent.
 */
export function authOptionsFromEnv(): AuthOptions {
  const jwksUri = process.env.OIDC_JWKS_URL ?? process.env.OIDC_JWKS_URI;
  const issuer = process.env.OIDC_ISSUER_URL;
  const audience = process.env.OIDC_AUDIENCE;

  if (!jwksUri || !issuer || !audience) {
    throw new Error(
      "Missing OIDC configuration: OIDC_JWKS_URL (or OIDC_JWKS_URI), OIDC_ISSUER_URL, OIDC_AUDIENCE must all be set.",
    );
  }
  return { jwksUri, issuer, audience };
}

// ---------------------------------------------------------------------------
// Core authenticate helper
// ---------------------------------------------------------------------------

export interface AuthenticateOptions {
  tokenOptions?: TokenVerifyOptions;
  membershipRepo: MembershipRepository;
  /** If true, forged identity headers trigger 401 instead of 403. Default false (403). */
  rejectForgedHeaders?: boolean;
}

/**
 * Authenticate an incoming Next.js request.
 *
 * Steps:
 * 1. Detect and reject forged identity headers (defence-in-depth).
 * 2. Extract the Authorization: Bearer <token> header.
 * 3. Verify the JWT signature, issuer, audience, and expiry via JWKS.
 * 4. Resolve the Actor from the membership DB (organizationId, role, status).
 *
 * On success returns the Actor.
 * On failure throws an `AuthError` with an HTTP status code.
 */
export async function authenticate(
  request: NextRequest,
  options: AuthenticateOptions,
): Promise<Actor> {
  // 1. Forged header check (defence-in-depth).
  if (options.rejectForgedHeaders !== false) {
    const forged = detectForgedHeaders(request);
    if (forged) {
      throw new AuthError(
        "FORGED_IDENTITY_HEADER",
        `Client-supplied identity header '${forged}' is not permitted`,
        403,
      );
    }
  }

  // 2. Extract bearer token.
  const authHeader = request.headers.get("authorization");

  // 3. Verify JWT.
  const tokenOpts: TokenVerifyOptions = options.tokenOptions ?? authOptionsFromEnv();
  let claims;
  try {
    claims = await verifyBearerToken(authHeader, tokenOpts);
  } catch (err) {
    if (err instanceof TokenError) throw err;
    throw new AuthError("TOKEN_VERIFY_FAILED", String(err), 401);
  }

  // 4. Resolve actor from membership DB.
  try {
    return await resolveActor(claims, options.membershipRepo);
  } catch (err) {
    if (err instanceof ActorResolutionError) throw err;
    throw new AuthError("ACTOR_RESOLVE_FAILED", String(err), 403);
  }
}

// ---------------------------------------------------------------------------
// Convenience: build an error NextResponse
// ---------------------------------------------------------------------------

/**
 * Build a standard JSON 401/403 response for auth failures.
 * Never includes token values or internal error messages.
 */
export function authErrorResponse(
  code: string,
  status: 401 | 403,
  requestId?: string | null,
): NextResponse {
  return NextResponse.json(
    { error: code, status },
    {
      status,
      headers: requestId ? { "x-request-id": requestId } : {},
    },
  );
}

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

/** Unified auth error with HTTP status. */
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

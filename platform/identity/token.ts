// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bearer token verification via JWKS (jose).
 *
 * Decision: Bearer API auth — authorization-code + PKCE only to obtain tokens.
 * Ref: ADR 0004-identity-session-keycloak.md, D04 decision-log row.
 *
 * Usage:
 *   const claims = await verifyBearerToken(authorizationHeader, {
 *     jwksUri: process.env.OIDC_JWKS_URI!,
 *     issuer:  process.env.OIDC_ISSUER_URL!,
 *     audience: process.env.OIDC_AUDIENCE!,
 *   });
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface TokenVerifyOptions {
  /** JWKS endpoint, e.g. https://keycloak:8080/realms/nexora/protocol/openid-connect/certs */
  jwksUri: string;
  /** Expected issuer claim — must match OIDC_ISSUER_URL exactly. */
  issuer: string;
  /** Expected audience (client ID or resource server name). */
  audience: string;
}

/** Subset of JWT claims used by Nexora identity resolution. */
export interface NexoraClaims extends JWTPayload {
  /** Keycloak subject — stable per user across token refresh. */
  sub: string;
  /** Realm roles injected by Keycloak role mapper. */
  realm_access?: { roles: string[] };
  /** Preferred username (display only; not used for authz). */
  preferred_username?: string;
  email?: string;
}

/**
 * Verify a Bearer token and return parsed claims.
 * Throws if the token is missing, expired, wrong issuer/audience, or signature invalid.
 *
 * @param authorizationHeader - value of the Authorization header (e.g. "Bearer eyJ…")
 */
export async function verifyBearerToken(
  authorizationHeader: string | undefined | null,
  options: TokenVerifyOptions,
): Promise<NexoraClaims> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new TokenError("MISSING_BEARER", "Authorization header must be Bearer <token>", 401);
  }
  const token = authorizationHeader.slice(7);

  const JWKS = createRemoteJWKSet(new URL(options.jwksUri));
  const { payload } = await jwtVerify<NexoraClaims>(token, JWKS, {
    issuer: options.issuer,
    audience: options.audience,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TokenError("INVALID_TOKEN", msg, 401);
  });

  if (!payload.sub) {
    throw new TokenError("MISSING_SUB", "Token has no sub claim", 401);
  }
  return payload;
}

/**
 * Extract realm roles from Nexora claims.
 * Returns an empty array if the claim is absent.
 */
export function realmRoles(claims: NexoraClaims): string[] {
  return claims.realm_access?.roles ?? [];
}

/** Structured token error — carries HTTP status for use in middleware. */
export class TokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

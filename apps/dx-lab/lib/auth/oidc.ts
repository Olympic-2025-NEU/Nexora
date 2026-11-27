// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { authConfig } from "./config";
import type { PkceSession, TokenSet } from "./session";

function endpoint(base: URL, suffix: string) {
  const realmPath = authConfig().issuerUrl.pathname.replace(/\/$/, "");
  return new URL(`${realmPath}${suffix}`, base);
}

export function beginLogin(next: string): { url: URL; pkce: PkceSession } {
  const config = authConfig();
  const pkce = {
    verifier: randomBytes(32).toString("base64url"),
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"), next,
  };
  const challenge = createHash("sha256").update(pkce.verifier).digest("base64url");
  const url = endpoint(config.issuerUrl, "/protocol/openid-connect/auth");
  url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId,
    redirect_uri: config.redirectUri, scope: "openid profile", code_challenge: challenge,
    code_challenge_method: "S256", state: pkce.state, nonce: pkce.nonce }).toString();
  return { url, pkce };
}

export function stateMatches(expected: string, received: string | null) {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const config = authConfig();
  body.set("client_id", config.clientId);
  const response = await fetch(endpoint(config.backchannelUrl, "/protocol/openid-connect/token"), {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`OIDC token exchange failed (${response.status})`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("Invalid OIDC token response");
  return value as TokenSet;
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code,
    code_verifier: verifier, redirect_uri: authConfig().redirectUri }));
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function verifyLoginIdToken(token: string | undefined, nonce: string) {
  if (!token) throw new Error("OIDC ID token missing");
  const config = authConfig();
  await jwtVerify(token, createRemoteJWKSet(config.jwksUrl), {
    issuer: config.issuerUrl.href.replace(/\/$/, ""), audience: config.clientId,
    requiredClaims: ["sub", "nonce"],
  }).then(({ payload }) => {
    if (payload.nonce !== nonce) throw new Error("OIDC nonce mismatch");
  });
}

export function logoutUrl() {
  const config = authConfig();
  const url = endpoint(config.issuerUrl, "/protocol/openid-connect/logout");
  url.search = new URLSearchParams({ client_id: config.clientId,
    post_logout_redirect_uri: new URL("/dxlab", config.publicBaseUrl).href }).toString();
  return url;
}

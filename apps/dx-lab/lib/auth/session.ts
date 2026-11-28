// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { NextResponse } from "next/server";
import { authConfig } from "./config";

export const ACCESS_COOKIE = "nexora_dxlab_access";
export const REFRESH_COOKIE = "nexora_dxlab_refresh";
export const PKCE_COOKIE = "nexora_dxlab_pkce";

export interface PkceSession {
  verifier: string;
  state: string;
  nonce: string;
  next: string;
}
export interface AccessSession { token: string; expiresAt: number; }
export interface RefreshSession { token: string; expiresAt: number; }
export interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in: number;
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: authConfig().secureCookies,
    path: "/dxlab", maxAge };
}

async function seal(payload: Record<string, unknown>, seconds: number): Promise<string> {
  return new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .encrypt(authConfig().sessionKey);
}

async function open(value: string | undefined): Promise<Record<string, unknown> | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, authConfig().sessionKey, { clockTolerance: 5 });
    return payload;
  } catch { return null; }
}

export async function writePkce(response: NextResponse, value: PkceSession) {
  response.cookies.set(PKCE_COOKIE, await seal({ ...value }, 300), cookieOptions(300));
}

export async function readPkce(value: string | undefined): Promise<PkceSession | null> {
  const payload = await open(value);
  return payload && typeof payload.verifier === "string" && typeof payload.state === "string" &&
    typeof payload.nonce === "string" && typeof payload.next === "string"
    ? { verifier: payload.verifier, state: payload.state, nonce: payload.nonce, next: payload.next } : null;
}

export async function writeTokens(response: NextResponse, tokens: TokenSet) {
  if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" ||
      !Number.isInteger(tokens.expires_in) || tokens.expires_in < 1 ||
      !Number.isInteger(tokens.refresh_expires_in) || tokens.refresh_expires_in < 1) {
    throw new Error("Invalid OIDC token response");
  }
  const accessSeconds = Math.min(tokens.expires_in, 3600);
  const refreshSeconds = Math.min(tokens.refresh_expires_in, 86400);
  const access = await seal({ token: tokens.access_token,
    expiresAt: Date.now() + accessSeconds * 1000 }, accessSeconds);
  const refresh = await seal({ token: tokens.refresh_token,
    expiresAt: Date.now() + refreshSeconds * 1000 }, refreshSeconds);
  response.cookies.set(ACCESS_COOKIE, access, cookieOptions(accessSeconds));
  response.cookies.set(REFRESH_COOKIE, refresh, cookieOptions(refreshSeconds));
}

export async function readAccess(value: string | undefined): Promise<AccessSession | null> {
  const payload = await open(value);
  return payload && typeof payload.token === "string" && typeof payload.expiresAt === "number"
    ? { token: payload.token, expiresAt: payload.expiresAt } : null;
}

export async function readRefresh(value: string | undefined): Promise<RefreshSession | null> {
  const payload = await open(value);
  return payload && typeof payload.token === "string" && typeof payload.expiresAt === "number"
    ? { token: payload.token, expiresAt: payload.expiresAt } : null;
}

export function clearSession(response: NextResponse) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, PKCE_COOKIE]) {
    response.cookies.set(name, "", cookieOptions(0));
  }
}

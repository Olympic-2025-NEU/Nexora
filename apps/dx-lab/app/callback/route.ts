// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMe } from "../../lib/api-client/client";
import { authConfig } from "../../lib/auth/config";
import { exchangeCode, stateMatches, verifyLoginIdToken } from "../../lib/auth/oidc";
import { PKCE_COOKIE, readPkce, writeTokens } from "../../lib/auth/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const pkce = await readPkce(request.cookies.get(PKCE_COOKIE)?.value);
  if (!code || !pkce || !stateMatches(pkce.state, request.nextUrl.searchParams.get("state"))) {
    return NextResponse.json({ code: "LOGIN_EXPIRED" }, { status: 401,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  try {
    const tokens = await exchangeCode(code, pkce.verifier);
    await verifyLoginIdToken(tokens.id_token, pkce.nonce);
    await getMe(tokens.access_token);
    const response = NextResponse.redirect(new URL(pkce.next, authConfig().publicBaseUrl), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    await writeTokens(response, tokens);
    response.cookies.set(PKCE_COOKIE, "", { path: "/dxlab", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ code: "LOGIN_FAILED" }, { status: 401,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}

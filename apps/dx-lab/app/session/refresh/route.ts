// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMe } from "../../../lib/api-client/client";
import { authConfig } from "../../../lib/auth/config";
import { refreshTokens } from "../../../lib/auth/oidc";
import { safeNext, signInPath } from "../../../lib/auth/paths";
import { clearSession, readRefresh, REFRESH_COOKIE, writeTokens } from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const config = authConfig();
  const refresh = await readRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
  if (refresh && refresh.expiresAt > Date.now()) {
    try {
      const tokens = await refreshTokens(refresh.token);
      await getMe(tokens.access_token);
      const response = NextResponse.redirect(new URL(next, config.publicBaseUrl), 303);
      response.headers.set("Cache-Control", "no-store");
      await writeTokens(response, tokens);
      return response;
    } catch { /* Expired, revoked or no longer a member. */ }
  }
  const response = NextResponse.redirect(new URL(signInPath(next, "expired"), config.publicBaseUrl), 303);
  response.headers.set("Cache-Control", "no-store");
  clearSession(response);
  return response;
}

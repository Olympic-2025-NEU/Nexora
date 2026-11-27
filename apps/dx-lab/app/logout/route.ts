// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authConfig } from "../../lib/auth/config";
import { logoutUrl } from "../../lib/auth/oidc";
import { clearSession } from "../../lib/auth/session";

export function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const config = authConfig();
  if (origin !== config.publicBaseUrl.origin) {
    return NextResponse.json({ code: "CSRF_DENIED" }, { status: 403 });
  }
  const response = NextResponse.redirect(logoutUrl(), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  clearSession(response);
  return response;
}

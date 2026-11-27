// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { beginLogin } from "../../lib/auth/oidc";
import { safeNext } from "../../lib/auth/paths";
import { writePkce } from "../../lib/auth/session";

export async function GET(request: NextRequest) {
  try {
    const { url, pkce } = beginLogin(safeNext(request.nextUrl.searchParams.get("next")));
    const response = NextResponse.redirect(url, 302);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    await writePkce(response, pkce);
    return response;
  } catch {
    return NextResponse.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}

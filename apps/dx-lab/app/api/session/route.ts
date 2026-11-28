// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ApiError, getMe } from "../../../lib/api-client/client";
import { ACCESS_COOKIE, readAccess } from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const session = await readAccess(request.cookies.get(ACCESS_COOKIE)?.value);
  if (!session || session.expiresAt <= Date.now()) {
    return NextResponse.json({ code: "SESSION_EXPIRED" }, { status: 401,
      headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json({ data: await getMe(session.token) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ApiError && [401, 403].includes(error.status) ? error.status : 503;
    return NextResponse.json({ code: status === 401 ? "SESSION_EXPIRED" :
      status === 403 ? "POLICY_DENIED" : "UPSTREAM_UNAVAILABLE" }, { status,
      headers: { "Cache-Control": "no-store" } });
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Path context only. Authentication and authorization happen in the server
// data access layer and again in the gateway/owning API.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const path = request.nextUrl.pathname.startsWith("/dxlab")
    ? request.nextUrl.pathname : `/dxlab${request.nextUrl.pathname}`;
  headers.set("x-dxlab-path", `${path}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/:path*" };

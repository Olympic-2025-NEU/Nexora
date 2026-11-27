// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse, type NextRequest } from "next/server";

/** Propagate request/correlation IDs; latency histograms live in Node via route helpers. */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const correlationId = request.headers.get("x-correlation-id") ?? requestId;
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};

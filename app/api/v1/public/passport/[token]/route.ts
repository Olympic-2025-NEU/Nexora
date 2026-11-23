// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/public/passport/:token
 *
 * Returns a safe public projection of a passport QR token.
 * Anonymous access — no authentication required.
 *
 * Security requirements:
 * - Returns only safe fields; never exposes batch IDs, internal IDs, or PII.
 * - Unknown or revoked tokens return 404 (not 403) to prevent enumeration.
 * - POST/PUT/DELETE/PATCH are blocked at the gateway; app also rejects them.
 * - Response includes cache-control headers to prevent proxy caching of 404s.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  void request; // The first route argument is required when reading dynamic params.
  const { token } = await params;

  // Validate token format: alphanumeric + hyphens, 10-128 chars.
  // Rejects path traversal, SQL injection attempts, etc.
  if (!/^[a-zA-Z0-9_-]{10,128}$/.test(token)) {
    // Return 404 (not 400) to avoid leaking validation rules.
    return NextResponse.json(
      { error: "NOT_FOUND" },
      {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  // TODO (P06+): Query actual passport/batch from DB via public projection service.
  // For now, return 404 for all unknown tokens — safe default.
  // The projection must NOT include: batch ID, lot numbers, internal IDs, sub, PII.

  // Stub: always 404 until passport registry is implemented in P08/P09.
  return NextResponse.json(
    { error: "NOT_FOUND" },
    {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

// Explicit method handlers — Next.js will return 405 for other methods automatically,
// but explicit denial makes the intent clear and allows custom response bodies.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function PUT(): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function PATCH(): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

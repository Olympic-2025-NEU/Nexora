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

/** Safe public fields returned for a valid passport token. */
interface PassportProjection {
  /** Opaque token identifier — same as the route param. */
  token: string;
  /** Display-friendly product name (no SKU or internal ID). */
  productName: string;
  /** Product category label. */
  category: string;
  /** ISO 8601 date string for manufactured date, if available. */
  manufacturedOn: string | null;
  /** ISO 8601 date string for expiry, if available. */
  expiresOn: string | null;
  /** Quality status (safe label — not the internal code). */
  qualityLabel: string;
  /** Issuing organization display name. */
  issuedBy: string;
  /** True if the QR code is still valid/active. */
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
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
export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function PUT(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function PATCH(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function DELETE(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createQrService } from "@/contexts/traceability/application/qr-token";

type Context = { params: Promise<{ token: string }> };
const headers = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
const notFound = () => NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });

export async function GET(_request: NextRequest, context: Context): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    const passport = await createQrService(getPrismaClient()).publicPassport(token);
    return passport ? NextResponse.json({ data: passport, requestId: crypto.randomUUID() },
      { headers }) : notFound();
  } catch {
    return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

export async function HEAD(request: NextRequest, context: Context): Promise<Response> {
  const result = await GET(request, context);
  return new Response(null, { status: result.status, headers: result.headers });
}

const methodNotAllowed = () => NextResponse.json({ error: "METHOD_NOT_ALLOWED" },
  { status: 405, headers });
export async function POST() { return methodNotAllowed(); }
export async function PUT() { return methodNotAllowed(); }
export async function PATCH() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }

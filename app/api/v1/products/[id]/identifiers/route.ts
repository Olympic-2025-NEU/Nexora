// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { fail } from "@/contexts/catalog/application/http";

/** P06 identifiers superseded by product_variant sku/barcode (P065 / ADR 0017). */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  return fail("IDENTIFIERS_REMOVED_USE_VARIANTS", 410, requestId);
}

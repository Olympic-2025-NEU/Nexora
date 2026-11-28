// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { orderRoute } from "@/contexts/sales";

/** POS one-shot create + checkout (Idempotency-Key required). */
export async function POST(request: NextRequest) {
  return orderRoute(request, undefined, "checkout");
}

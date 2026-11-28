// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { orderRoute } from "@/contexts/sales";

export async function GET(request: NextRequest) {
  return orderRoute(request);
}

export async function POST(request: NextRequest) {
  return orderRoute(request);
}

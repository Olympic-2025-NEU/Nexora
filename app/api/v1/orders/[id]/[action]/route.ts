// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { orderRoute } from "@/contexts/sales";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await context.params;
  return orderRoute(request, id, action);
}

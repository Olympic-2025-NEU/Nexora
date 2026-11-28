// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { traceBackwardRoute } from "@/contexts/traceability/application/backward-http";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return traceBackwardRoute(request, id);
}

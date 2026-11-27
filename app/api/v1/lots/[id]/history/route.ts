// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { lotHistoryRoute } from "@/contexts/traceability/application/history-http";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return lotHistoryRoute(request, id);
}

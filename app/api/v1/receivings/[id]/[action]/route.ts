// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { receivingRoute } from "@/contexts/trading";
export const POST = async (request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }) => {
  const { id, action } = await params;
  return receivingRoute(request, id, action);
};

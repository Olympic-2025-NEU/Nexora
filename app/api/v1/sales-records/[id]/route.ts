// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { saleRoute } from "@/contexts/trading";
export const GET = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  saleRoute(request, (await params).id);

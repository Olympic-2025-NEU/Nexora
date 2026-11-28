// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { tradingRoute } from "@/contexts/trading";
export const GET = (request: NextRequest) => tradingRoute(request, "goods_issue");
export const POST = (request: NextRequest) => tradingRoute(request, "goods_issue");

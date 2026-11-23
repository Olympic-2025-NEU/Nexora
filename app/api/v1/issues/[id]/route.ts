// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { tradingRoute } from "@/contexts/trading";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: NextRequest, { params }: Context) =>
  tradingRoute(request, "goods_issue", (await params).id);
export const PATCH = async (request: NextRequest, { params }: Context) =>
  tradingRoute(request, "goods_issue", (await params).id);

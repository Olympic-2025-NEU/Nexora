// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { historyRoute } from "@/contexts/trading";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: NextRequest, { params }: Context) =>
  historyRoute(request, (await params).id);

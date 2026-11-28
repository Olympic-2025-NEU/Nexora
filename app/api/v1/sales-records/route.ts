// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { saleRoute } from "@/contexts/trading";
export const GET = (request: NextRequest) => saleRoute(request);
export const POST = (request: NextRequest) => saleRoute(request);

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { stocktakeRoute } from "@/contexts/trading";
export const GET = (request: NextRequest) => stocktakeRoute(request);
export const POST = (request: NextRequest) => stocktakeRoute(request);

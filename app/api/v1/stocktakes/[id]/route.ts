// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { stocktakeRoute } from "@/contexts/trading";
type Params = { params: Promise<{ id: string }> };
export const GET = async (request: NextRequest, { params }: Params) => stocktakeRoute(request, (await params).id);
export const PATCH = async (request: NextRequest, { params }: Params) => stocktakeRoute(request, (await params).id);

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { transferRoute } from "@/contexts/trading";
export const GET = (request: NextRequest) => transferRoute(request);
export const POST = (request: NextRequest) => transferRoute(request);

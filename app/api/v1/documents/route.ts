// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { historyRoute } from "@/contexts/trading";
export const GET = (request: NextRequest) => historyRoute(request);

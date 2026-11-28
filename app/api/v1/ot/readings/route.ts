// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { otReadingRoute } from "@/contexts/traceability/application/ot-http";

export async function POST(request: NextRequest) {
  return otReadingRoute(request);
}

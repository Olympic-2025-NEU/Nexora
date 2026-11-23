// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { traceStatusRoute } from "@/contexts/traceability/application/status-http";

export async function GET(request: NextRequest) { return traceStatusRoute(request); }

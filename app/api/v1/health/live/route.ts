// SPDX-License-Identifier: AGPL-3.0-only
import { healthResponse } from "@/platform/observability/health";

export function GET(request: Request) {
  return healthResponse(request, "erp", true);
}

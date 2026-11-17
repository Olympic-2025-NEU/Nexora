// SPDX-License-Identifier: AGPL-3.0-only
import { healthResponse } from "@/platform/observability/health";
import { databaseReady } from "@/platform/observability/readiness";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  const ready = await databaseReady();
  return healthResponse(request, "erp", ready, ready ? undefined : "dependency_unavailable");
}

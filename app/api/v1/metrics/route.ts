// SPDX-License-Identifier: AGPL-3.0-only
import { connection } from "next/server";
import { databaseReady } from "@/platform/observability/readiness";
import { log, requestId } from "@/platform/observability/health";

export async function GET(request: Request) {
  await connection();
  const id = requestId(request.headers.get("x-request-id"));
  const up = await databaseReady();
  log("erp", id, "metrics", up ? "up" : "down");
  return new Response(`# TYPE service_up gauge\nservice_up{service="erp"} ${Number(up)}\n`, {
    headers: { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store", "x-request-id": id },
  });
}

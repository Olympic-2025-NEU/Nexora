// SPDX-License-Identifier: AGPL-3.0-only
import { databaseReady } from "@/platform/observability/readiness";
import { log, requestId } from "@/platform/observability/health";
import { httpMetricsText, recordHttpRequest } from "@/platform/observability/http-metrics";
import { workMetrics } from "@/platform/observability/metrics";
import { getPrismaClient } from "@/platform/persistence/prisma";

export async function GET(request: Request) {
  const started = Date.now();
  const id = requestId(request.headers.get("x-request-id"));
  const up = await databaseReady();
  log("erp", id, "metrics", up ? "up" : "down");
  const metrics = up ? await workMetrics(getPrismaClient()) : "";
  recordHttpRequest({
    method: "GET",
    route: "/api/v1/metrics",
    status: 200,
    seconds: (Date.now() - started) / 1000,
  });
  const body = `# TYPE service_up gauge\nservice_up{service="erp"} ${Number(up)}\n${metrics}${httpMetricsText()}`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; version=0.0.4",
      "cache-control": "no-store",
      "x-request-id": id,
      "x-correlation-id": request.headers.get("x-correlation-id") ?? id,
    },
  });
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { requirePolicy } from "@/platform/access/policy";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError, ok } from "@/contexts/catalog/application/http";
import { listQualityIssues } from "@/contexts/traceability/application/quality-issues";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "ops:quality:read");
    const params = request.nextUrl.searchParams;
    const rows = await listQualityIssues(getPrismaClient(), {
      state: params.get("state") ?? undefined,
      severity: params.get("severity") ?? undefined,
      ruleId: params.get("ruleId") ?? undefined,
    });
    return ok(rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      state: row.state,
      severity: row.severity,
      firstDetectedAt: row.firstDetectedAt.toISOString(),
      lastDetectedAt: row.lastDetectedAt.toISOString(),
      version: row.version,
    })), requestId);
  } catch (error) {
    return mapRouteError(error, requestId);
  }
}

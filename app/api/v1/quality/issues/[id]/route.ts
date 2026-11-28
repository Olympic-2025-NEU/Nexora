// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { requirePolicy } from "@/platform/access/policy";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError, ok } from "@/contexts/catalog/application/http";
import { getQualityIssue } from "@/contexts/traceability/application/quality-issues";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "ops:quality:read");
    const { id } = await context.params;
    const row = await getQualityIssue(getPrismaClient(), id);
    return ok({
      id: row.id,
      ruleId: row.ruleId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      state: row.state,
      severity: row.severity,
      sourceEventIds: row.sourceEventIds,
      detail: row.detail,
      policyVersion: row.policyVersion,
      firstDetectedAt: row.firstDetectedAt.toISOString(),
      lastDetectedAt: row.lastDetectedAt.toISOString(),
      version: row.version,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedBySub: row.resolvedBySub,
    }, requestId);
  } catch (error) {
    return mapRouteError(error, requestId);
  }
}

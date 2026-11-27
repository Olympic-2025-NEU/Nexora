// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { requirePolicy } from "@/platform/access/policy";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { DomainError } from "@/platform/kernel/errors";
import { mapRouteError, ok } from "@/contexts/catalog/application/http";
import { resolveQualityIssue } from "@/contexts/traceability/application/quality-issues";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "ops:quality:manage");
    const { id } = await context.params;
    const ifMatch = request.headers.get("if-match");
    if (!ifMatch) throw new DomainError("VERSION_REQUIRED", 428);
    const version = Number(ifMatch);
    if (!Number.isInteger(version)) throw new DomainError("VERSION_INVALID", 422);
    const body = await request.json() as { reason?: string };
    const row = await resolveQualityIssue(
      getPrismaClient(), id, version, String(body.reason ?? ""), actor.userId, requestId,
    );
    return ok({ id: row.id, state: row.state, version: row.version }, requestId);
  } catch (error) {
    return mapRouteError(error, requestId);
  }
}

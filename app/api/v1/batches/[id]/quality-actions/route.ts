// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  isUuid,
  mapRouteError,
  ok,
  parseIfMatchVersion,
  projectBatch,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import type { QualityStatus } from "@/contexts/catalog/domain/types";
import { catalogAuditRecorder } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Params = { params: Promise<{ id: string }> };

const ACTION_TO_STATUS: Record<string, QualityStatus> = {
  mark_available: "available",
  restrict: "restricted",
  inspect: "inspect",
};

export async function POST(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("BATCH_NOT_FOUND", 404);
    const body = assertBody(await readJson(request), ["action", "reason", "version"]);
    if (
      typeof body.action !== "string" ||
      !Object.prototype.hasOwnProperty.call(ACTION_TO_STATUS, body.action)
    ) {
      throw new DomainError("QUALITY_ACTION_INVALID", 422);
    }
    const target = ACTION_TO_STATUS[body.action]!;
    const reason = requireText(body.reason, "REASON_REQUIRED", 500);
    const expectedVersion = parseIfMatchVersion(request.headers.get("if-match"), body.version);
    if (!expectedVersion) throw new DomainError("VERSION_REQUIRED", 422);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:batch:quality",
        method: "POST",
        routeKey: `batches/${id}/quality-actions`,
        payload: { action: body.action, reason: "[present]", version: body.version },
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createCatalogRepos(ctx.tx);
          const before = await repos.findBatchById(id);
          if (!before) throw new DomainError("BATCH_NOT_FOUND", 404);
          if (before.qualityStatus === target) {
            throw new DomainError("BATCH_QUALITY_UNCHANGED", 409);
          }
          const updated = await repos.updateBatchQuality(id, expectedVersion, target);
          if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: `batch.quality.${body.action as string}`,
            targetType: "batch",
            targetId: updated.id,
            requestId: ctx.requestId,
            before: { status: before.qualityStatus, version: before.version },
            after: {
              status: updated.qualityStatus,
              version: updated.version,
              reason,
              changedFields: ["status", "version"],
            },
          });
          return updated;
        },
      },
    );
    return ok(projectBatch(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

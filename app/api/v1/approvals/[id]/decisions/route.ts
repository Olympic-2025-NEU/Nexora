// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "@/composition/system";
import { decideApproval } from "@/composition/approvals";
import { tradingIdempotency, tradingUnitOfWork } from "@/composition/trading";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { assertBody, isUuid, mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DomainError("APPROVAL_ID_INVALID", 422);
    const body = assertBody(await readJson(request), ["decision", "note"]);
    if (body.decision !== "approve" && body.decision !== "reject") throw new DomainError("DECISION_INVALID", 422);
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) {
      throw new DomainError("NOTE_INVALID", 422);
    }
    if (body.decision === "reject" && !String(body.note ?? "").trim()) throw new DomainError("NOTE_REQUIRED", 422);
    const key = request.headers.get("idempotency-key");
    if (!key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const result = await runCommand({ requestId }, {
      authenticate: () => resolveUserActor(request),
      resolveTenant: async (actor) => {
        if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return actor.organizationId;
      },
      action: "workflow:approval:decide", method: "POST", routeKey: `approvals:${id}:decisions`,
      payload: body, idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      domain: async (ctx) => {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return decideApproval(ctx.tx, ctx.actor, id, body.decision === "approve" ? "approved" : "rejected",
          body.note as string | undefined);
      },
    });
    return ok(result, requestId, 202);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = String(error.code);
      if (code === "SELF_APPROVAL") return mapRouteError(new DomainError(code, 403), requestId);
      if (["APPROVAL_SCOPE", "APPROVAL_NOT_READY", "VERSION_CONFLICT", "DECISION_CONFLICT"].includes(code)) {
        return mapRouteError(new DomainError(code, code === "APPROVAL_SCOPE" ? 403 : 409), requestId);
      }
    }
    return mapRouteError(error, requestId);
  }
}

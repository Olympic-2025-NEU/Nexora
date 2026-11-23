// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { runCommand } from "@/platform/http/pipeline";
import { checkPolicy } from "@/platform/access/policy";
import { assertBody, isUuid, mapRouteError, ok, parseIfMatchVersion, readJson } from "@/contexts/catalog/application/http";
import { receivingService, tradingIdempotency, tradingRead, tradingUnitOfWork } from "@/composition/trading";
import { resolveUserActor } from "@/composition/system";
import type { ActualInput, ReceivingEdit } from "./receivings";

function parseLines(raw: unknown, edit: boolean): ActualInput[] {
  if (!Array.isArray(raw) || (!edit && !raw.length) || raw.length > 100) throw new DomainError("SOURCE_LINE_MISSING", 422);
  return raw.map((value) => {
    const line = assertBody(value, edit
      ? ["sourceLineId", "actualQuantity", "localBatchId", "warehouseId", "discrepancyReason"]
      : ["sourceLineId", "localBatchId", "warehouseId", "actualQuantity", "unit"]);
    for (const key of edit ? ["sourceLineId"] : ["sourceLineId", "localBatchId", "warehouseId"]) {
      if (!isUuid(line[key])) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
    }
    if (edit) {
      for (const key of ["localBatchId", "warehouseId"]) {
        if (line[key] !== undefined && !isUuid(line[key])) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
      }
    }
    if ((!edit || line.actualQuantity !== undefined) && typeof line.actualQuantity !== "string") {
      throw new DomainError("QUANTITY_INVALID", 422);
    }
    if (!edit && !["EA", "KG", "L"].includes(line.unit as string)) throw new DomainError("QUANTITY_UNIT_MISMATCH", 422);
    if (line.discrepancyReason !== undefined && (typeof line.discrepancyReason !== "string" || line.discrepancyReason.length > 1000)) {
      throw new DomainError("DISCREPANCY_REASON_INVALID", 422);
    }
    return line as ActualInput;
  });
}

export async function receivingRoute(request: NextRequest, id?: string, action?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    if (action && !["confirm", "cancel"].includes(action)) throw new DomainError("ACTION_INVALID", 422);
    const service = receivingService();
    if (request.method === "GET" && !action) {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, "trading:receiving:read").allowed) throw new DomainError("POLICY_DENIED", 403);
      return tradingRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await service.view(ctx, id), requestId);
        const messageId = request.nextUrl.searchParams.get("batchesFor");
        if (messageId) {
          if (!isUuid(messageId)) throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
          return ok(await service.batches(ctx, messageId), requestId);
        }
        if (request.nextUrl.searchParams.has("options")) return ok(await service.options(ctx), requestId);
        const page = await service.list(ctx);
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }
    if (request.method !== "POST" && request.method !== "PATCH") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    if (request.method === "PATCH" && (!id || action)) throw new DomainError("METHOD_NOT_ALLOWED", 405);
    if (request.method === "POST" && id && !action) throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const body = assertBody(await readJson(request), action ? [] : request.method === "PATCH"
      ? ["actualLines", "discrepancyReason"] : ["inboundMessageId", "actualLines", "discrepancyReason"]);
    if (!action && request.method === "POST" && !isUuid(body.inboundMessageId)) throw new DomainError("SOURCE_MESSAGE_NOT_FOUND", 422);
    if (!action && request.method === "POST" && body.actualLines === undefined) throw new DomainError("SOURCE_LINE_MISSING", 422);
    if (body.actualLines !== undefined) body.actualLines = parseLines(body.actualLines, request.method === "PATCH");
    if (body.discrepancyReason !== undefined &&
      (typeof body.discrepancyReason !== "string" || body.discrepancyReason.length > 1000)) {
      throw new DomainError("DISCREPANCY_REASON_INVALID", 422);
    }
    const version = id ? parseIfMatchVersion(request.headers.get("if-match")) : null;
    if (id && version === null) throw new DomainError("IF_MATCH_REQUIRED", 428);
    const key = request.headers.get("idempotency-key") ?? undefined;
    if (action === "confirm" && !key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const verb = action ?? (id ? "update" : "create");
    const result = await runCommand({ requestId }, {
      authenticate: () => resolveUserActor(request),
      resolveTenant: async (actor) => {
        if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return actor.organizationId;
      },
      action: `trading:receiving:${verb}`, method: request.method,
      routeKey: `receiving:${id ?? "collection"}:${verb}`, payload: { body, version },
      idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (id && version !== null && action === "cancel") return service.cancel(args, id, version);
        if (id && version !== null && action === "confirm") return service.confirm(args, id, version);
        if (id && version !== null) return service.edit(args, id, version, body as ReceivingEdit);
        return service.create(args, body as { inboundMessageId: string; actualLines: ActualInput[]; discrepancyReason?: string });
      },
    });
    return ok(result, requestId, id ? 200 : 201);
  } catch (error) {
    if (!action && request.method === "POST" && error instanceof Error && "code" in error && error.code === "P2002") {
      return mapRouteError(new DomainError("RECEIVING_ALREADY_EXISTS", 409), requestId);
    }
    return mapRouteError(error, requestId);
  }
}

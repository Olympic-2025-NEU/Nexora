// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { runCommand } from "@/platform/http/pipeline";
import { checkPolicy } from "@/platform/access/policy";
import { assertBody, isUuid, mapRouteError, ok, parseIfMatchVersion, readJson } from "@/contexts/catalog/application/http";
import { stocktakeService, tradingIdempotency, tradingRead, tradingUnitOfWork } from "@/composition/trading";
import { resolveUserActor } from "@/composition/system";
import type { StocktakeInput, StocktakeLineInput } from "./stocktakes";

function lines(raw: unknown): StocktakeLineInput[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new DomainError("LINES_INVALID", 422);
  return raw.map((value) => {
    const line = assertBody(value, ["warehouseId", "productVariantId", "batchId", "countedQuantity", "uomId"]);
    for (const key of ["warehouseId", "productVariantId", "batchId", "uomId"]) {
      if (!isUuid(line[key])) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
    }
    if (typeof line.countedQuantity !== "string") throw new DomainError("QUANTITY_INVALID", 422);
    return line as StocktakeLineInput;
  });
}

export async function stocktakeRoute(request: NextRequest, id?: string, action?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    if (action && !["confirm", "cancel"].includes(action)) throw new DomainError("ACTION_INVALID", 422);
    const service = stocktakeService();
    if (request.method === "GET" && !action) {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, "trading:stocktake:read").allowed) throw new DomainError("POLICY_DENIED", 403);
      return tradingRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await service.view(ctx, id), requestId);
        if (request.nextUrl.searchParams.has("options")) return ok(await service.options(ctx), requestId);
        const page = await service.list(ctx);
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }
    if (request.method !== "POST" && request.method !== "PATCH") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    if ((request.method === "PATCH" && (!id || action)) || (request.method === "POST" && id && !action)) {
      throw new DomainError("METHOD_NOT_ALLOWED", 405);
    }
    const body = assertBody(await readJson(request), action ? [] : request.method === "PATCH"
      ? ["lines", "note"] : ["lines", "note", "correctionOfDocumentId", "correctionReason"]);
    if (!action && request.method === "POST" && body.lines === undefined) throw new DomainError("LINES_INVALID", 422);
    if (body.lines !== undefined) body.lines = lines(body.lines);
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) {
      throw new DomainError("NOTE_INVALID", 422);
    }
    if (!action && request.method === "POST") {
      if (body.correctionOfDocumentId !== undefined && !isUuid(body.correctionOfDocumentId)) throw new DomainError("CORRECTION_INVALID", 422);
      if (body.correctionReason !== undefined && typeof body.correctionReason !== "string") throw new DomainError("CORRECTION_INVALID", 422);
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
      action: `trading:stocktake:${verb}`, method: request.method,
      routeKey: `stocktake:${id ?? "collection"}:${verb}`, payload: { body, version },
      idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (id && version !== null && action === "cancel") return service.cancel(args, id, version);
        if (id && version !== null && action === "confirm") return service.confirm(args, id, version);
        if (id && version !== null) return service.edit(args, id, version, body as { lines?: StocktakeLineInput[]; note?: string });
        return service.create(args, body as StocktakeInput);
      },
    });
    return ok(result, requestId, id ? 200 : 201);
  } catch (error) { return mapRouteError(error, requestId); }
}

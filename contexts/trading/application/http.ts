// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { runCommand } from "@/platform/http/pipeline";
import { checkPolicy } from "@/platform/access/policy";
import { assertBody, isUuid, mapRouteError, ok, parseIfMatchVersion, readJson } from "@/contexts/catalog/application/http";
import { tradingIdempotency, tradingRead, tradingService, tradingUnitOfWork, transferService } from "@/composition/trading";
import { resolveUserActor } from "@/composition/system";
import { StockShortage, type TradingKind, type LineInput, type DocumentInput } from "./documents";
import type { DocumentStatus } from "../domain/document";

const actions = ["submit", "confirm", "cancel"] as const;
const statuses = ["draft", "pending_approval", "approved", "confirmed", "cancelled", "rejected"];

function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new DomainError("LINES_INVALID", 422);
  return raw.map((value) => {
    const line = assertBody(value, ["warehouseId", "productVariantId", "batchId", "quantity", "uomId"]);
    for (const key of ["warehouseId", "productVariantId", "batchId", "uomId"]) {
      if (!isUuid(line[key])) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
    }
    if (typeof line.quantity !== "string") throw new DomainError("QUANTITY_INVALID", 422);
    return line as LineInput;
  });
}

function parseInput(raw: unknown, kind: TradingKind, edit = false) {
  const body = assertBody(raw, edit ? ["lines", "note"] :
    ["lines", "note", "purpose", "correctionOfDocumentId", "correctionReason"]);
  if (!edit && body.lines === undefined) throw new DomainError("LINES_INVALID", 422);
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) {
    throw new DomainError("NOTE_INVALID", 422);
  }
  if (!edit) {
    for (const key of ["correctionOfDocumentId", "correctionReason"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" ||
        (key === "correctionOfDocumentId" && !isUuid(body[key])))) throw new DomainError("CORRECTION_INVALID", 422);
    }
    if (kind === "goods_receipt" && body.purpose !== undefined) throw new DomainError("FIELD_NOT_ALLOWED", 422);
    if (kind === "goods_issue" && !["other", "sale", "partner_transfer"].includes(body.purpose as string)) {
      throw new DomainError("ISSUE_PURPOSE_REQUIRED", 422);
    }
  }
  return { ...body, ...(body.lines !== undefined ? { lines: parseLines(body.lines) } : {}) } as DocumentInput;
}

function mapError(err: unknown, requestId: string): Response {
  if (err instanceof StockShortage) return NextResponse.json({ error: err.code, status: 422,
    details: { batchId: err.batchId, requested: err.requested, available: err.available }, requestId }, { status: 422 });
  if (err instanceof Error && "code" in err && err.code === "SNAPSHOT_MISMATCH") {
    return mapRouteError(new DomainError("APPROVAL_LINE_MISMATCH", 409), requestId);
  }
  if (err instanceof Error && "code" in err && err.code === "APPROVAL_SCOPE") {
    return mapRouteError(new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403), requestId);
  }
  if (err instanceof Error && "code" in err && err.code === "APPROVAL_NOT_READY") {
    return mapRouteError(new DomainError("APPROVAL_NOT_YET_APPROVED", 409), requestId);
  }
  return mapRouteError(err, requestId);
}

export async function tradingRoute(request: NextRequest, kind: TradingKind,
  id?: string, action?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    const verb = request.method === "GET" ? "read" : action ?? (id ? "edit" : "create");
    if (action && (!actions.includes(action as typeof actions[number]) ||
      (kind === "goods_receipt" && action === "submit"))) throw new DomainError("ACTION_NOT_FOUND", 404);
    const policy = `trading:${kind === "goods_receipt" ? "receipt" : "issue"}:${verb}`;
    if (request.method === "GET") {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, policy).allowed) throw new DomainError("POLICY_DENIED", 403);
      return tradingRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await tradingService.view(ctx, id, kind), requestId);
        const status = request.nextUrl.searchParams.get("status");
        if (status && !statuses.includes(status)) throw new DomainError("STATUS_INVALID", 422);
        const page = await tradingService.list(ctx, kind, status as DocumentStatus | undefined);
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }
    if (request.method !== "POST" && request.method !== "PATCH") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const raw = await readJson(request);
    const body = action ? assertBody(raw, []) : parseInput(raw, kind, request.method === "PATCH");
    const version = id ? parseIfMatchVersion(request.headers.get("if-match")) : null;
    if (id && version === null) throw new DomainError("IF_MATCH_REQUIRED", 428);
    const key = request.headers.get("idempotency-key") ?? undefined;
    if (action === "confirm" && !key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const result = await runCommand({ requestId }, {
      authenticate: () => resolveUserActor(request),
      resolveTenant: async (actor) => {
        if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return actor.organizationId;
      },
      action: policy, method: request.method, routeKey: `${kind}:${id ?? "collection"}:${action ?? verb}`,
      idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      payload: { body, version },
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (action && id && version !== null) return tradingService.action(args, kind, id,
          action as typeof actions[number], version);
        if (request.method === "PATCH" && id && version !== null) return tradingService.edit(args, kind, id,
          version, body as { lines?: LineInput[]; note?: string });
        return tradingService.create(args, kind, body as DocumentInput);
      },
    });
    return ok(result, requestId, id ? 200 : 201);
  } catch (err) { return mapError(err, requestId); }
}

export async function transferRoute(request: NextRequest, id?: string, action?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    if (action && !["confirm", "cancel"].includes(action)) throw new DomainError("ACTION_NOT_FOUND", 404);
    const service = transferService();
    if (request.method === "GET" && !action) {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, "trading:transfer:read").allowed) throw new DomainError("POLICY_DENIED", 403);
      return tradingRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await service.view(ctx, id), requestId);
        if (request.nextUrl.searchParams.has("options")) return ok(await service.options(ctx), requestId);
        const page = await service.list(ctx);
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }
    if (request.method !== "POST") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const body = assertBody(await readJson(request), action ? [] : ["linkedIssueId", "destinationPartnerId", "note"]);
    if (!action) {
      if (!isUuid(body.linkedIssueId)) throw new DomainError("LINKED_ISSUE_ID_INVALID", 422);
      if (!isUuid(body.destinationPartnerId)) throw new DomainError("DESTINATION_PARTNER_ID_INVALID", 422);
      if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) {
        throw new DomainError("NOTE_INVALID", 422);
      }
    }
    const version = id ? parseIfMatchVersion(request.headers.get("if-match")) : null;
    if (id && version === null) throw new DomainError("IF_MATCH_REQUIRED", 428);
    const key = request.headers.get("idempotency-key") ?? undefined;
    if (action === "confirm" && !key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const result = await runCommand({ requestId }, {
      authenticate: () => resolveUserActor(request),
      resolveTenant: async (actor) => {
        if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return actor.organizationId;
      },
      action: `trading:transfer:${action ?? "create"}`, method: "POST",
      routeKey: `transfer:${id ?? "collection"}:${action ?? "create"}`, payload: { body, version },
      idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (id && version !== null && action === "cancel") return service.cancel(args, id, version);
        if (id && version !== null && action === "confirm") return service.confirm(args, id, version);
        return service.create(args, body as { linkedIssueId: string; destinationPartnerId: string; note?: string });
      },
    });
    return ok(result, requestId, id ? 200 : 201);
  } catch (err) {
    if (!action && err instanceof Error && "code" in err && err.code === "P2002") {
      return mapRouteError(new DomainError("TRANSFER_ALREADY_EXISTS", 409), requestId);
    }
    return mapRouteError(err, requestId);
  }
}

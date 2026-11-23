// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { runCommand } from "@/platform/http/pipeline";
import { checkPolicy } from "@/platform/access/policy";
import { assertBody, isUuid, mapRouteError, ok, parseIfMatchVersion, readJson } from "@/contexts/catalog/application/http";
import { saleService, tradingIdempotency, tradingRead, tradingUnitOfWork } from "@/composition/trading";
import { resolveUserActor } from "@/composition/system";

export async function saleRoute(request: NextRequest, id?: string, action?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    if (action && !["confirm", "cancel"].includes(action)) throw new DomainError("ACTION_INVALID", 422);
    const service = saleService();
    if (request.method === "GET" && !action) {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, "trading:sale:read").allowed) throw new DomainError("POLICY_DENIED", 403);
      return tradingRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await service.view(ctx, id), requestId);
        if (request.nextUrl.searchParams.has("options")) return ok(await service.options(ctx), requestId);
        const page = await service.list(ctx);
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }
    if (request.method !== "POST" || (id && !action)) throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const body = assertBody(await readJson(request), action ? [] : ["linkedIssueId", "buyerRef", "soldAt"]);
    if (!action) {
      if (!isUuid(body.linkedIssueId)) throw new DomainError("LINKED_ISSUE_ID_INVALID", 422);
      if (body.buyerRef !== undefined && typeof body.buyerRef !== "string") throw new DomainError("BUYER_REF_INVALID", 422);
      if (typeof body.buyerRef === "string" && body.buyerRef.trim().length > 64) throw new DomainError("BUYER_REF_TOO_LONG", 422);
      if (body.soldAt !== undefined && (typeof body.soldAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(body.soldAt) ||
        !Number.isFinite(Date.parse(body.soldAt)))) throw new DomainError("INVALID_SOLD_AT", 422);
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
      action: `trading:sale:${action ?? "create"}`, method: request.method,
      routeKey: `sale:${id ?? "collection"}:${action ?? "create"}`, payload: { body, version },
      idempotencyKey: key, idempotencyPort: tradingIdempotency(), unitOfWork: tradingUnitOfWork,
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (id && version !== null && action === "cancel") return service.cancel(args, id, version);
        if (id && version !== null && action === "confirm") return service.confirm(args, id, version);
        return service.create(args, body as { linkedIssueId: string; buyerRef?: string; soldAt?: string });
      },
    });
    return ok(result, requestId, id ? 200 : 201);
  } catch (error) {
    if (!action && error instanceof Error && "code" in error && error.code === "P2002") {
      return mapRouteError(new DomainError("SALE_ALREADY_EXISTS", 409), requestId);
    }
    return mapRouteError(error, requestId);
  }
}

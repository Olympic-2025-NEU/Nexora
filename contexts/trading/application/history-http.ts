// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { checkPolicy } from "@/platform/access/policy";
import { isUuid, mapRouteError, ok } from "@/contexts/catalog/application/http";
import { tradingRead } from "@/composition/trading";
import { resolveUserActor } from "@/composition/system";
import { createHistoryService, type HistoryFilters } from "./history";
import type { DocumentStatus } from "../domain/document";

const types = ["goods_receipt", "goods_issue", "partner_transfer", "receiving_confirmation", "stocktake", "sale_record"];
const statuses = ["draft", "pending_approval", "approved", "confirmed", "cancelled", "rejected"];

function parseFilters(request: NextRequest): HistoryFilters {
  const params = request.nextUrl.searchParams;
  const filters: HistoryFilters = {};
  const type = params.get("type");
  if (type) {
    if (!types.includes(type)) throw new DomainError("TYPE_INVALID", 422);
    filters.type = type;
  }
  const status = params.get("status");
  if (status) {
    if (!statuses.includes(status)) throw new DomainError("STATUS_INVALID", 422);
    filters.status = status as DocumentStatus;
  }
  for (const key of ["batchId", "partnerId", "cursorId"] as const) {
    const value = params.get(key);
    if (value) {
      if (!isUuid(value)) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
      filters[key] = value;
    }
  }
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new DomainError(`${key.toUpperCase()}_INVALID`, 422);
      filters[key] = date;
    }
  }
  const limit = params.get("limit");
  if (limit) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new DomainError("LIMIT_INVALID", 422);
    filters.limit = parsed;
  }
  return filters;
}

export async function historyRoute(request: NextRequest, id?: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("DOCUMENT_ID_INVALID", 422);
    if (request.method !== "GET") throw new DomainError("METHOD_NOT_ALLOWED", 405);
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "trading:history:read").allowed) throw new DomainError("POLICY_DENIED", 403);
    return tradingRead(async (tx) => {
      const ctx = { tx, actor, requestId, emit: () => {} };
      const service = createHistoryService();
      if (id) return ok(await service.view(ctx, id), requestId);
      const page = await service.list(ctx, parseFilters(request));
      return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
    });
  } catch (err) { return mapRouteError(err, requestId); }
}

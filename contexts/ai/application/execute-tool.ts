// SPDX-License-Identifier: AGPL-3.0-only
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import type { BusinessApiPort, ToolAuditPort, ToolContext } from "./ports";
import { isToolName, validateToolInput, type ToolName } from "./tool-registry";
import { BusinessApiError } from "../infrastructure/business-api";

type Row = Record<string, unknown>;
type Result = Row & { sourceIds: string[]; asOf: string;
  verificationStatus: "local_verified" | "partner_asserted" | "missing"; gaps: unknown[] };

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("AI_UPSTREAM_INVALID", 503);
  }
  return value as Row;
}

function list(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new DomainError("AI_UPSTREAM_INVALID", 503);
  return value.map(row);
}

function value(record: Row, key: string): string {
  if (typeof record[key] !== "string") throw new DomainError("AI_UPSTREAM_INVALID", 503);
  return record[key];
}

function data(envelope: unknown): unknown { return row(envelope).data; }
function page(envelope: unknown): Row { return row(row(envelope).page); }

function scaled(input: string, places: number): bigint {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(input)) throw new DomainError("AI_QUANTITY_INVALID", 422);
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > places) throw new DomainError("AI_QUANTITY_INVALID", 422);
  return BigInt(whole!) * BigInt(10) ** BigInt(places) + BigInt(fraction.padEnd(places, "0") || "0");
}

function fixed3(amount: bigint): string {
  return `${amount / BigInt(1000)}.${(amount % BigInt(1000)).toString().padStart(3, "0")}`;
}

function requireWarehouseScope(ctx: ToolContext, warehouseId: string): void {
  if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  }
}

function policyFor(name: ToolName): string {
  return ({ getLot: "catalog:batch:read", getStock: "inventory:stock:read",
    getTrace: "trace:read", createReceiptDraft: "trading:receipt:create",
    createIssueDraft: "trading:issue:create" } as const)[name];
}

async function getLot(api: BusinessApiPort, ctx: ToolContext, input: Row): Promise<Result> {
  let batch: Row;
  if (typeof input.batchId === "string") {
    batch = row(data(await api.get(`/api/v1/batches/${input.batchId}`, ctx.authorization, ctx.requestId)));
  } else {
    let cursor: string | null = null;
    const matches: Row[] = [];
    for (let step = 0; step < 10; step++) {
      const response = await api.get(`/api/v1/batches?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ctx.authorization, ctx.requestId);
      for (const candidate of list(data(response))) {
        const origin = row(candidate.originLot);
        if (origin.issuerInstanceId === input.originIssuerId && origin.lotId === input.originLotId) {
          matches.push(candidate);
          if (matches.length > 1) throw new DomainError("AI_LOT_AMBIGUOUS", 409);
        }
      }
      const next = page(response).nextCursor;
      if (next === null || next === undefined) break;
      if (typeof next !== "string" || step === 9) throw new DomainError("AI_LOT_LOOKUP_TRUNCATED", 409);
      cursor = next;
    }
    if (!matches[0]) throw new DomainError("AI_LOT_NOT_FOUND", 404);
    batch = matches[0];
  }
  const product = row(data(await api.get(`/api/v1/products/${value(batch, "productId")}`,
    ctx.authorization, ctx.requestId)));
  const batchId = value(batch, "id");
  const productId = value(product, "id");
  const origin = row(batch.originLot);
  const expiresOn = typeof batch.expiresOn === "string" ? batch.expiresOn : null;
  return { batchId, product: { id: productId, name: value(product, "name") },
    originLot: { issuerInstanceId: value(origin, "issuerInstanceId"), lotId: value(origin, "lotId") },
    qualityStatus: value(batch, "qualityStatus"), expiresOn, sourceIds: [batchId, productId],
    verificationStatus: "local_verified", gaps: [],
    asOf: (ctx.now ?? (() => new Date()))().toISOString() };
}

async function getStock(api: BusinessApiPort, ctx: ToolContext, input: Row): Promise<Result> {
  const batchId = input.batchId as string;
  const warehouseId = input.warehouseId as string | undefined;
  if (warehouseId) requireWarehouseScope(ctx, warehouseId);
  const query = `/api/v1/inventory/balances?batchId=${batchId}&limit=20${warehouseId ? `&warehouseId=${warehouseId}` : ""}`;
  const response = await api.get(query, ctx.authorization, ctx.requestId);
  const balances = list(data(response));
  let total = BigInt(0);
  const projected = balances.map((balance) => {
    const quantity = value(balance, "quantity");
    total += scaled(quantity, 3);
    return { warehouseId: value(balance, "warehouseId"), quantity };
  });
  const uomId = balances.length ? value(balances[0]!, "stockUomId") : null;
  const uoms = uomId ? list(data(await api.get("/api/v1/uoms", ctx.authorization, ctx.requestId))) : [];
  const unit = uomId ? value(uoms.find((uom) => uom.id === uomId) ?? {}, "code") : "unknown";
  const updated = balances.map((balance) => value(balance, "updatedAt")).sort().at(-1);
  const noScope = !ctx.actor.roles.includes("administrator") && ctx.actor.unitIds.length === 0;
  const truncated = !!page(response).nextCursor;
  return { batchId, balances: projected, visibleTotalQuantity: fixed3(total), unit,
    truncated, sourceIds: [batchId, ...projected.map((item) => item.warehouseId)],
    verificationStatus: noScope ? "missing" : "local_verified",
    gaps: noScope ? [{ state: "no_visible_warehouses" }] : truncated ? [{ state: "truncated" }] : [],
    asOf: updated ?? (ctx.now ?? (() => new Date()))().toISOString() };
}

async function getTrace(api: BusinessApiPort, ctx: ToolContext, input: Row): Promise<Result> {
  const batchId = input.batchId as string;
  const direction = input.direction as "backward" | "forward";
  const depth = (input.depth as number | undefined) ?? 3;
  const trace = row(data(await api.get(`/api/v1/lots/${batchId}/trace/${direction}?depth=${depth}&limit=20`,
    ctx.authorization, ctx.requestId)));
  const rawNodes = list(trace.nodes);
  const rawEdges = list(trace.edges);
  const rawGaps = list(trace.gaps);
  const nodes = rawNodes.slice(0, 10).map((node) => ({
    eventId: value(node, "eventId"), issuerInstanceId: value(node, "issuerInstanceId"),
    verificationState: value(node, "verificationState"),
    eventType: typeof node.eventType === "string" ? node.eventType : "unknown",
  }));
  const edges = rawEdges.slice(0, 5).map((edge) => ({
    fromEventId: typeof edge.fromEventId === "string" ? edge.fromEventId : null,
    toEventId: typeof edge.toEventId === "string" ? edge.toEventId : null,
    relation: typeof edge.relation === "string" ? edge.relation : "unknown",
  }));
  const gaps = rawGaps.slice(0, 5).map((gap) => ({
    state: value(gap, "state"), reason: typeof gap.reason === "string" ? gap.reason : "unknown",
  }));
  return { batchId, direction, nodes, edges, gaps,
    truncated: rawNodes.length > 10 || rawEdges.length > 5 || rawGaps.length > 5,
    verificationStates: [...new Set(nodes.map((node) => node.verificationState))],
    verificationStatus: gaps.length ? "missing" : nodes.some((node) => node.verificationState === "partner_asserted")
      ? "partner_asserted" : "local_verified",
    sourceIds: [batchId, ...nodes.map((node) => node.eventId)],
    asOf: value(trace, "asOf") };
}

async function createDraft(api: BusinessApiPort, ctx: ToolContext, input: Row,
  kind: "receipt" | "issue"): Promise<Result> {
  const warehouseId = input.warehouseId as string;
  const batchId = input.batchId as string;
  requireWarehouseScope(ctx, warehouseId);
  if (!ctx.idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(ctx.idempotencyKey)) {
    throw new DomainError("AI_IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  if (scaled(input.quantity as string, 3) <= BigInt(0)) throw new DomainError("AI_QUANTITY_INVALID", 422);
  const batch = row(data(await api.get(`/api/v1/batches/${batchId}`, ctx.authorization, ctx.requestId)));
  const variantId = value(batch, "productVariantId");
  const uoms = list(data(await api.get("/api/v1/uoms", ctx.authorization, ctx.requestId)));
  const uom = uoms.find((item) => item.code === input.unit && item.isActive !== false);
  if (!uom) throw new DomainError("AI_UOM_INVALID", 422);
  const uomId = value(uom, "id");
  const variantUoms = list(data(await api.get(`/api/v1/variants/${variantId}/uoms`,
    ctx.authorization, ctx.requestId)));
  const conversion = variantUoms.find((item) => item.uomId === uomId);
  if (!conversion) throw new DomainError("AI_UOM_INVALID", 422);
  if (kind === "issue") {
    const balanceResponse = await api.get(`/api/v1/inventory/balances?batchId=${batchId}&warehouseId=${warehouseId}&limit=20`,
      ctx.authorization, ctx.requestId);
    const available = list(data(balanceResponse)).reduce((sum, item) => sum + scaled(value(item, "quantity"), 3), BigInt(0));
    const factor = scaled(value(conversion, "factorToStockUom"), 6);
    if (scaled(input.quantity as string, 3) * factor > available * BigInt(1_000_000)) {
      throw new DomainError("AI_STOCK_INSUFFICIENT", 422);
    }
  }
  const body = { lines: [{ warehouseId, batchId, productVariantId: variantId,
    quantity: input.quantity, uomId }],
    ...(typeof input.note === "string" ? { note: input.note } : {}),
    ...(kind === "issue" ? { purpose: input.purpose } : {}),
  };
  const endpoint = kind === "issue" ? "/api/v1/issues" : "/api/v1/receipts";
  const document = row(data(await api.post(endpoint, body, ctx.authorization, ctx.requestId,
    ctx.idempotencyKey)));
  if (document.status !== "draft") throw new DomainError("AI_DRAFT_STATE_INVALID", 503);
  const id = value(document, "id");
  return { draftDocumentId: id, status: "draft", warnings: [],
    ...(kind === "issue" ? { purpose: input.purpose } : {}),
    sourceIds: [batchId, id], verificationStatus: "local_verified", gaps: [],
    asOf: (ctx.now ?? (() => new Date()))().toISOString() };
}

export function createToolExecutor(api: BusinessApiPort, audit: ToolAuditPort) {
  return async (name: string, rawInput: unknown, ctx: ToolContext): Promise<Result> => {
    if (!isToolName(name)) throw new DomainError("AI_TOOL_NOT_FOUND", 404);
    let input: Row;
    try {
      input = validateToolInput(name, rawInput);
      if (!checkPolicy(ctx.actor, policyFor(name)).allowed) throw new DomainError("POLICY_DENIED", 403);
      if (["getStock", "createReceiptDraft", "createIssueDraft"].includes(name) &&
          typeof input.warehouseId === "string") requireWarehouseScope(ctx, input.warehouseId);
      if (["createReceiptDraft", "createIssueDraft"].includes(name) &&
          (!ctx.idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(ctx.idempotencyKey))) {
        throw new DomainError("AI_IDEMPOTENCY_KEY_REQUIRED", 400);
      }
      if (!/^Bearer [A-Za-z0-9._~+/=-]+$/.test(ctx.authorization)) {
        throw new DomainError("AI_DELEGATION_INVALID", 401);
      }
    } catch (error) {
      await audit.complete(ctx.actor, name, ctx.requestId, "deny");
      throw error;
    }
    if (!await audit.reserve(ctx.actor, name, ctx.requestId)) {
      throw new DomainError("AI_TOOL_RATE_LIMITED", 429);
    }
    let result: Result | undefined;
    let failure: unknown;
    try {
      if (name === "getLot") result = await getLot(api, ctx, input);
      if (name === "getStock") result = await getStock(api, ctx, input);
      if (name === "getTrace") result = await getTrace(api, ctx, input);
      if (name === "createReceiptDraft") result = await createDraft(api, ctx, input, "receipt");
      if (name === "createIssueDraft") result = await createDraft(api, ctx, input, "issue");
    } catch (error) {
      failure = error instanceof BusinessApiError ? new DomainError(error.code, error.status) : error;
    }
    await audit.complete(ctx.actor, name, ctx.requestId,
      failure ? (failure instanceof DomainError && [401, 403].includes(failure.httpStatus) ? "deny" : "failure") : "success",
      result?.sourceIds);
    if (failure) throw failure;
    if (!result) throw new DomainError("AI_TOOL_UNAVAILABLE", 503);
    return result;
  };
}

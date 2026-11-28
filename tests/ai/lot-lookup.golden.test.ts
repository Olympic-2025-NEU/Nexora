// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@/platform/identity/actor";
import { sanitizeAuditSummary } from "@/platform/audit/prisma-audit-recorder";
import { createToolExecutor } from "@/contexts/ai/application/execute-tool";
import type { BusinessApiPort, ToolAuditPort, ToolContext } from "@/contexts/ai/application/ports";
import {
  runChatLotLookup,
  type AnswerAuditEntry,
  type ChatDependencies,
  type GeneratePort,
  type ToolRun,
} from "@/contexts/ai/application/chat-lot-lookup";
import { createAiGenerateClient } from "@/contexts/ai/infrastructure/ai-generate-client";
import { BusinessApiError } from "@/contexts/ai/infrastructure/business-api";

const SEED = {
  batchA: "26020d35-e804-4763-a3cb-f069051c0e80",
  batchB: "52589bdf-6acd-4f2f-a7b1-1d7b5a133c47",
  originB: "3e0e02dd-c026-4d4c-a036-681476f0aa56",
  warehouseA: "c391cd45-5ec8-4f8e-aae6-a153f0b04e8a",
  productA: "d09754a7-a188-4117-a417-6bfd48678be6",
  productB: "71862d97-ee69-4f02-a0a5-56af5fb00504",
  eventA: "bde2cb94-5be6-4ba4-ad11-81a6d09559e3",
  eventB: "3f837b40-0fde-4a46-ae8b-0863e298c2b4",
  uomCai: "aaaaaaaa-0001-4000-8000-000000000001",
  maLotTrung: "LOT-A-001",
  soLuong: "0.000",
  donVi: "CAI",
  asOf: "2026-11-26T00:00:00.000Z",
  requestId: "yeu-cau-ac10-001",
  devStaff: "dev-staff",
} as const;

type Batch = {
  id: string;
  productId: string;
  localCode: string;
  originLot: { issuerInstanceId: string; lotId: string };
  qualityStatus: string;
};

const BATCHES: readonly Batch[] = [
  { id: SEED.batchA, productId: SEED.productA, localCode: SEED.maLotTrung,
    originLot: { issuerInstanceId: "nexora-a", lotId: SEED.maLotTrung }, qualityStatus: "inspect" },
  { id: SEED.batchB, productId: SEED.productB, localCode: SEED.maLotTrung,
    originLot: { issuerInstanceId: "nexora-b", lotId: SEED.maLotTrung }, qualityStatus: "available" },
];

const TEN_SAN_PHAM: Record<string, string> = {
  [SEED.productA]: "Demo Product A",
  [SEED.productB]: "Demo Product AI B",
};

const SU_KIEN: Record<string, { eventId: string; eventType: string }> = {
  [SEED.batchA]: { eventId: SEED.eventA, eventType: "receipt" },
  [SEED.batchB]: { eventId: SEED.eventB, eventType: "receipt" },
};

const staffActor: Actor = {
  userId: SEED.devStaff,
  organizationId: "nexora-a",
  unitIds: [SEED.warehouseA],
  roles: ["inventory_clerk"],
  displayName: SEED.devStaff,
};

function apiFixture(lots: readonly Batch[] = BATCHES) {
  const calls: { path: string; authorization: string; requestId: string }[] = [];
  const api: BusinessApiPort = {
    async get(path, authorization, requestId) {
      calls.push({ path, authorization, requestId });
      if (path.startsWith("/api/v1/batches?")) return { data: lots, page: { nextCursor: null } };
      if (path.startsWith("/api/v1/batches/")) {
        const batch = lots.find((item) => item.id === path.split("/").at(-1));
        if (!batch) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: batch };
      }
      if (path.startsWith("/api/v1/products/")) {
        const productId = path.split("/").at(-1) ?? "";
        const name = TEN_SAN_PHAM[productId];
        if (!name) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: { id: productId, name } };
      }
      if (path.startsWith("/api/v1/inventory/balances?")) {
        const batchId = new URL(path, "http://localhost").searchParams.get("batchId");
        const balances = SU_KIEN[batchId ?? ""]
          ? [{ warehouseId: SEED.warehouseA, quantity: SEED.soLuong,
            stockUomId: SEED.uomCai, updatedAt: SEED.asOf }]
          : [];
        return { data: balances, page: { nextCursor: null } };
      }
      if (path === "/api/v1/uoms") {
        return { data: [{ id: SEED.uomCai, code: SEED.donVi, name: "CÁI", isActive: true }] };
      }
      const trace = path.match(/^\/api\/v1\/lots\/([0-9a-f-]+)\/trace\//);
      if (trace) {
        const node = SU_KIEN[trace[1]!] ?? { eventId: SEED.eventB, eventType: "receipt" };
        return { data: { nodes: [{ ...node, issuerInstanceId: "nexora-b",
          verificationState: "partner_asserted" }], edges: [], gaps: [], asOf: SEED.asOf } };
      }
      throw new Error(`Đường API fixture không mong đợi: ${path}`);
    },
    async post() {
      throw new Error("Golden test không gọi API ghi");
    },
  };
  return { api, calls };
}

function toolAuditFixture() {
  const completions: { tool: string; outcome: string; sourceIds?: string[] }[] = [];
  const port: ToolAuditPort = {
    async reserve() { return true; },
    async complete(_actor, tool, _requestId, outcome, sourceIds) {
      completions.push({ tool, outcome, sourceIds });
    },
  };
  return { port, completions };
}

function chatFixture(options: {
  actor?: Actor;
  lots?: readonly Batch[];
  generate?: GeneratePort;
  withWarehouseScope?: boolean;
} = {}) {
  const apiState = apiFixture(options.lots);
  const auditState = toolAuditFixture();
  const executor = createToolExecutor(apiState.api, auditState.port);
  const toolResults = new Map<string, Record<string, unknown>>();
  const answerAudits: AnswerAuditEntry[] = [];
  const storedAudits: Record<string, unknown>[] = [];
  const runTool: ToolRun = async (name, input, ctx) => {
    const enforced = options.withWarehouseScope && name === "getStock"
      ? { ...(input as Record<string, unknown>), warehouseId: SEED.warehouseA }
      : input;
    const result = await executor(name, enforced, ctx);
    toolResults.set(name, result as Record<string, unknown>);
    return result;
  };
  const deps: ChatDependencies = {
    actor: options.actor ?? staffActor,
    authorization: "Bearer dev-staff.golden.token",
    requestId: SEED.requestId,
    runTool,
    generate: options.generate,
    allowedIssuers: ["nexora-a", "nexora-b"],
    now: () => new Date(SEED.asOf),
    auditAnswer: {
      async record(entry) {
        answerAudits.push(entry);
        storedAudits.push(sanitizeAuditSummary({
          quantity: entry.quantity, unit: entry.unit, sourceIds: entry.sourceIds,
          asOf: entry.asOf, verification: entry.verification, count: entry.toolCalls,
        }) as Record<string, unknown>);
      },
    },
  };
  return { deps, runTool, toolResults, answerAudits, storedAudits,
    apiCalls: apiState.calls, toolAudits: auditState.completions };
}

function toolContext(actor: Actor): ToolContext {
  return { actor, authorization: "Bearer dev-staff.golden.token",
    requestId: SEED.requestId, now: () => new Date(SEED.asOf) };
}

test("khớp số chính xác giữa câu trả lời và fixture API đã seed", async () => {
  const sample = chatFixture();
  const result = await runChatLotLookup({ question: `Lô ${SEED.batchB} của nexora-b?` }, sample.deps);
  assert.equal(result.status, "answered", "phải trả lời được lô demo đã seed");
  if (result.status !== "answered") return;
  assert.match(result.answer, /Tổng tồn hiện tại: 0\.000 CAI/, "số và đơn vị phải lấy từ fixture API");
  assert.match(result.answer, new RegExp(SEED.batchB), "nguồn phải là batchId đã seed");
  assert.match(result.answer, new RegExp(SEED.eventB), "sự kiện phải lấy từ getTrace");
  assert.equal(result.aiUnavailable, false);
  assert.equal(result.facts.length <= 10, true);
  assert.equal(sample.storedAudits.length, 1);
});

test("lô không tồn tại trả not_found, không gọi generation", async () => {
  let generated = false;
  const generate: GeneratePort = {
    async generate() {
      generated = true;
      return { answer: "Không có số liệu." };
    },
  };
  const sample = chatFixture({ generate });
  const result = await runChatLotLookup({ question: "Lô LOT-KHONG-CO của nexora-a?" }, sample.deps);
  assert.deepEqual(result, { status: "not_found", hint: "/trace", requestId: SEED.requestId },
    "lô vắng mặt phải dừng và gợi ý trang trace");
  assert.equal(generated, false, "không được gọi model khi không có lô");
  assert.equal(sample.storedAudits.length, 0, "không ghi audit đáp án khi không trả lời");
  assert.equal(sample.apiCalls.some((call) => call.path.includes("/inventory/balances")), false);
});

test("mã lô trùng giữa hai issuer bắt buộc chọn lại ứng viên", async () => {
  const sample = chatFixture();
  const result = await runChatLotLookup({
    question: `Lô ${SEED.maLotTrung} của nexora-a hoặc nexora-b?`,
  }, sample.deps);
  assert.equal(result.status, "ambiguous", "hai issuer cùng mã phải dừng chờ chọn");
  if (result.status !== "ambiguous") return;
  assert.deepEqual(result.candidates.map((candidate) => candidate.issuer),
    ["nexora-a", "nexora-b"], "phân giải phải giữ cả hai issuer được phép");
  assert.deepEqual(result.candidates.map((candidate) => candidate.batchId),
    [SEED.batchA, SEED.batchB], "ứng viên phải đúng batchId seed");
  assert.equal(sample.apiCalls.some((call) => call.path.includes("/inventory/balances") ||
    call.path.includes("/trace/")), false, "phải dừng trước getStock/getTrace");
  assert.equal(sample.storedAudits.length, 0, "không ghi audit đáp án khi chưa chốt lô");

  const scoped = chatFixture();
  scoped.deps.allowedIssuers = ["nexora-a"];
  const filtered = await runChatLotLookup({
    question: `Lô ${SEED.maLotTrung} của nexora-a hoặc nexora-b?`,
  }, scoped.deps);
  assert.equal(filtered.status, "answered", "chỉ còn một ứng viên sau khi lọc quyền");
  assert.equal(JSON.stringify(filtered).includes(SEED.batchB), false, "không lộ lô của issuer ngoài quyền");
  assert.equal(JSON.stringify(filtered).includes("nexora-b"), false, "không lộ issuer ngoài quyền");
});

test("provider trả 503 thì fallback template và báo AI_UNAVAILABLE", async () => {
  const saved = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_INTERNAL_TOKEN: process.env.AI_INTERNAL_TOKEN,
  };
  process.env.AI_PROVIDER = "ollama";
  process.env.AI_BASE_URL = "http://127.0.0.1:11434";
  process.env.AI_INTERNAL_TOKEN = "golden-token-0123456789abcdef0123456789abcdef";
  const adapterCalls: { url: string; token: string | undefined; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    adapterCalls.push({ url: String(url), token: headers?.["x-ai-internal-token"],
      body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ error: { code: "AI_UNAVAILABLE" } }), {
      status: 503, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const sample = chatFixture({ generate: createAiGenerateClient(fetcher) });
    const result = await runChatLotLookup({ question: `Lô ${SEED.batchB} của nexora-b?` }, sample.deps);
    assert.equal(result.status, "answered", "503 vẫn phải trả lời bằng template");
    if (result.status !== "answered") return;
    assert.equal(result.connector, null, "không dùng câu nối khi provider lỗi");
    assert.equal(result.aiUnavailable, true, "phải báo AI_UNAVAILABLE cho UI");
    assert.match(result.answer, /Tổng tồn hiện tại: 0\.000 CAI/, "template vẫn giữ số đúng");
    assert.equal(adapterCalls.length, 1);
    assert.equal(new URL(adapterCalls[0]!.url).pathname, "/v1/generate");
    assert.equal(adapterCalls[0]!.token, process.env.AI_INTERNAL_TOKEN);
    assert.deepEqual(Object.keys(adapterCalls[0]!.body).sort(), ["facts", "question"],
      "adapter chỉ nhận question và facts");
    assert.equal((adapterCalls[0]!.body.facts as unknown[]).length <= 10, true);
    assert.equal(JSON.stringify(adapterCalls[0]!.body).includes("Bearer"), false,
      "không gửi Bearer của user tới adapter");
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("nhân viên không thuộc kho bị từ chối 403 khi đọc tồn kho", async () => {
  const outside: Actor = { ...staffActor, unitIds: [] };
  const sample = chatFixture({ actor: outside });
  await assert.rejects(sample.runTool("getStock", { batchId: SEED.batchA,
    warehouseId: SEED.warehouseA }, toolContext(outside)),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 },
  "nhân viên không có membership kho phải bị từ chối 403");
  assert.equal(sample.apiCalls.length, 0, "không được gọi API khi đã chặn quyền kho");
  assert.equal(sample.toolAudits.at(-1)?.outcome, "deny", "lần từ chối phải ghi audit deny");
  assert.equal(sample.storedAudits.length, 0, "không ghi audit đáp án cho đường bị từ chối");
});

test("AC-10: số trong câu trả lời khớp audit và tool cùng request", async () => {
  const sample = chatFixture();
  const result = await runChatLotLookup({ question: `Lô ${SEED.batchB} của nexora-b?` }, sample.deps);
  assert.equal(result.status, "answered");
  if (result.status !== "answered") return;
  const trich = result.answer.match(
    /Tổng tồn hiện tại: (\d+\.\d{3}) ([A-Z]+), tính đến (\S+), nguồn ([0-9a-f-]+)\./,
  );
  assert.ok(trich, "câu trả lời phải render số, đơn vị, asOf và nguồn");
  if (!trich) return;
  const stock = sample.toolResults.get("getStock");
  const trace = sample.toolResults.get("getTrace");
  assert.equal(trich[1], stock?.visibleTotalQuantity, "số trong answer phải đúng kết quả getStock");
  assert.equal(trich[1], sample.answerAudits[0]?.quantity, "số trong answer phải đúng audit");
  assert.equal(trich[2], stock?.unit, "đơn vị trong answer phải đúng kết quả getStock");
  assert.equal(trich[2], sample.answerAudits[0]?.unit, "đơn vị trong answer phải đúng audit");
  assert.equal(trich[3], stock?.asOf, "asOf trong answer phải đúng kết quả getStock");
  assert.equal(trich[3], sample.answerAudits[0]?.asOf, "asOf trong answer phải đúng audit");
  assert.equal(trich[4], SEED.batchB, "nguồn trong answer phải đúng batchId đã hỏi");
  assert.equal(result.auditRequestId, SEED.requestId, "mã request audit phải trùng request hiện tại");
  assert.equal(sample.answerAudits[0]?.requestId, SEED.requestId);
  assert.deepEqual(sample.answerAudits[0]?.sourceIds,
    [SEED.batchB, SEED.warehouseA, SEED.eventB], "audit phải ghi nguồn đã render");
  assert.deepEqual(sample.storedAudits[0], {
    quantity: SEED.soLuong, unit: SEED.donVi, sourceIds: [SEED.batchB, SEED.warehouseA, SEED.eventB],
    asOf: SEED.asOf, verification: "partner_asserted", count: 3,
  }, "bản ghi audit sau sanitize phải giữ nguyên giá trị then chốt");
  const nguonSo = result.facts.flatMap((fact) => [fact.value, fact.sourceId, fact.asOf]);
  const soTrongAnswer = result.answer.match(/\d+(?:[.,]\d+)*/g) ?? [];
  for (const so of soTrongAnswer) {
    assert.equal(nguonSo.some((value) => value.includes(so)), true,
      `số ${so} trong answer phải thuộc fact bundle`);
  }
  assert.deepEqual(trace?.sourceIds, [SEED.batchB, SEED.eventB], "trace phải đúng fixture seed");
});

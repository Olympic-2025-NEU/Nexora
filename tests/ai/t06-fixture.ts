// SPDX-License-Identifier: AGPL-3.0-only
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
import type {
  DraftAuditEntry,
  DraftDependencies,
} from "@/contexts/ai/application/draft-receipt";
import { BusinessApiError } from "@/contexts/ai/infrastructure/business-api";

export const T06_SEED = {
  batchOwn: "26020d35-e804-4763-a3cb-f069051c0e80",
  batchPartner: "52589bdf-6acd-4f2f-a7b1-1d7b5a133c47",
  warehouseOwn: "c391cd45-5ec8-4f8e-aae6-a153f0b04e8a",
  warehouseOther: "9c391cd4-5ec8-4f8e-9ae6-a153f0b04e8a",
  productOwn: "d09754a7-a188-4117-a417-6bfd48678be6",
  productPartner: "71862d97-ee69-4f02-a0a5-56af5fb00504",
  variantOwn: "aaaaaaaa-0002-4000-8000-000000000001",
  variantPartner: "aaaaaaaa-0002-4000-8000-000000000002",
  eventOwn: "bde2cb94-5be6-4ba4-ad11-81a6d09559e3",
  eventPartner: "3f837b40-0fde-4a46-ae8b-0863e298c2b4",
  uomCai: "aaaaaaaa-0001-4000-8000-000000000001",
  lotCode: "LOT-A-001",
  requestId: "yeu-cau-p10-t06",
  asOf: "2026-11-26T00:00:00.000Z",
  canarySecret: "canary.p10t06@redaction.test",
  canaryPii: "0909123456",
} as const;

export const T06_TAG = {
  indirectInjection: "indirect-injection",
  authority: "authority",
  exfiltration: "exfiltration",
  quota: "quota",
  providerFailure: "provider-failure",
  logging: "logging",
} as const;

export const t06Actor: Actor = {
  userId: "dev-staff",
  organizationId: "nexora-a",
  unitIds: [T06_SEED.warehouseOwn],
  roles: ["staff"],
  displayName: "dev-staff",
};

const BATCHES = [
  { id: T06_SEED.batchOwn, productId: T06_SEED.productOwn,
    productVariantId: T06_SEED.variantOwn, originLot: { issuerInstanceId: "nexora-a", lotId: T06_SEED.lotCode },
    qualityStatus: "inspect" },
  { id: T06_SEED.batchPartner, productId: T06_SEED.productPartner,
    productVariantId: T06_SEED.variantPartner, originLot: { issuerInstanceId: "nexora-b", lotId: T06_SEED.lotCode },
    qualityStatus: "available" },
] as const;

type DocumentSeed = {
  id: string;
  status: string;
  lines: unknown[];
  note?: string;
  idempotencyKey: string;
};

export function t06Quota() {
  const startedAt = Date.parse(T06_SEED.asOf);
  let offset = 0;
  const clock = () => startedAt + offset;
  const state = { total: 0, drafts: 0, grants: 0, denies: 0, windowStart: clock() };
  const completions: { tool: string; outcome: string; sourceIds?: string[] }[] = [];
  const port: ToolAuditPort = {
    async reserve(_actor, tool) {
      const now = clock();
      if (now - state.windowStart >= 60_000) {
        state.windowStart = now;
        state.total = 0;
        state.drafts = 0;
      }
      const isDraft = tool === "createReceiptDraft" || tool === "createIssueDraft";
      if (state.total >= 30 || (isDraft && state.drafts >= 5)) {
        state.denies++;
        completions.push({ tool, outcome: "deny" });
        return false;
      }
      state.total++;
      state.grants++;
      if (isDraft) state.drafts++;
      return true;
    },
    async complete(_actor, tool, _requestId, outcome, sourceIds) {
      completions.push({ tool, outcome, ...(sourceIds ? { sourceIds } : {}) });
    },
  };
  return { port, state, completions, advance(ms: number) { offset += ms; } };
}

export function t06Generate(answer: string | null, seen: string[] = []): GeneratePort {
  return {
    async generate(question) {
      seen.push(question);
      return answer ? { answer } : null;
    },
  };
}

export async function captureAiLogs<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((method) => console[method]);
  const lines: string[] = [];
  for (const method of methods) {
    Object.assign(console, { [method]: (...args: unknown[]) => {
      lines.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
    } });
  }
  try {
    return { value: await run(), lines };
  } finally {
    for (const [index, method] of methods.entries()) Object.assign(console, { [method]: originals[index] });
  }
}

export function t06Fixture(options: {
  actor?: Actor;
  requestId?: string;
  allowedIssuers?: readonly string[];
  productName?: string;
  eventType?: string;
  balance?: string;
  quota?: ReturnType<typeof t06Quota>;
} = {}) {
  const actor = options.actor ?? t06Actor;
  const requestId = options.requestId ?? T06_SEED.requestId;
  const authorization = "Bearer dev-staff.t06.token";
  const quota = options.quota ?? t06Quota();
  const balances = new Map<string, string>([
    [`${T06_SEED.warehouseOwn}:${T06_SEED.batchOwn}`, options.balance ?? "5.000"],
    [`${T06_SEED.warehouseOwn}:${T06_SEED.batchPartner}`, "0.000"],
  ]);
  const hiddenBalances = new Map<string, string>([
    [`${T06_SEED.warehouseOther}:${T06_SEED.batchOwn}`, "9999.000"],
  ]);
  const documents: DocumentSeed[] = [];
  const calls: { method: string; path: string; body?: unknown; key?: string }[] = [];
  const toolCalls: { name: string; input: unknown; ctx: ToolContext }[] = [];
  const answerAudits: AnswerAuditEntry[] = [];
  const storedAudits: Record<string, unknown>[] = [];
  const draftAudits: DraftAuditEntry[] = [];
  const productNames: Record<string, string> = {
    [T06_SEED.productOwn]: options.productName ?? "Demo Product A",
    [T06_SEED.productPartner]: "Demo Product B",
  };

  const api: BusinessApiPort = {
    async get(path) {
      calls.push({ method: "GET", path });
      if (path.startsWith("/api/v1/batches?")) return { data: BATCHES, page: { nextCursor: null } };
      if (path.startsWith("/api/v1/batches/")) {
        const batch = BATCHES.find((item) => item.id === path.split("/").at(-1));
        if (!batch) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: batch };
      }
      if (path.startsWith("/api/v1/products/")) {
        const id = path.split("/").at(-1) ?? "";
        const name = productNames[id];
        if (!name) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: { id, name } };
      }
      if (path.startsWith("/api/v1/inventory/balances?")) {
        const url = new URL(path, "http://localhost");
        const batchId = url.searchParams.get("batchId") ?? "";
        const warehouseId = url.searchParams.get("warehouseId");
        const rows = [...balances].filter(([key]) => {
          const [rowWarehouse, rowBatch] = key.split(":");
          return rowBatch === batchId && actor.unitIds.includes(rowWarehouse ?? "") &&
            (!warehouseId || rowWarehouse === warehouseId);
        }).map(([key, quantity]) => ({
          warehouseId: key.split(":")[0], quantity, stockUomId: T06_SEED.uomCai, updatedAt: T06_SEED.asOf,
        }));
        return { data: rows, page: { nextCursor: null } };
      }
      if (path === "/api/v1/uoms") {
        return { data: [{ id: T06_SEED.uomCai, code: "CAI", name: "CÁI", isActive: true }] };
      }
      const variant = path.match(/^\/api\/v1\/variants\/([0-9a-f-]+)\/uoms$/);
      if (variant) {
        if (!([T06_SEED.variantOwn, T06_SEED.variantPartner] as string[]).includes(variant[1]!)) {
          throw new BusinessApiError(404, "AI_VARIANT_NOT_FOUND");
        }
        return { data: [{ uomId: T06_SEED.uomCai, factorToStockUom: "1.000000", isStockKeeping: true }] };
      }
      const trace = path.match(/^\/api\/v1\/lots\/([0-9a-f-]+)\/trace\//);
      if (trace) {
        const own = trace[1] === T06_SEED.batchOwn;
        return { data: {
          nodes: [{ eventId: own ? T06_SEED.eventOwn : T06_SEED.eventPartner,
            eventType: options.eventType ?? "receipt", issuerInstanceId: own ? "nexora-a" : "nexora-b",
            verificationState: "partner_asserted" }],
          edges: [], gaps: [], asOf: T06_SEED.asOf,
        } };
      }
      throw new Error(`Đường API fixture không mong đợi: ${path}`);
    },
    async post(path, body, _authorization, _requestId, key) {
      calls.push({ method: "POST", path, body, key });
      if (!path.includes("/receipts")) throw new Error("AI không được ghi đường khác receipts");
      const exist = documents.find((item) => item.idempotencyKey === key);
      if (exist) return { data: exist };
      const record = body as { lines: unknown[]; note?: string };
      const document: DocumentSeed = {
        id: `44444444-4444-4444-8444-${String(documents.length + 1).padStart(12, "0")}`,
        status: "draft", lines: record.lines,
        ...(typeof record.note === "string" ? { note: record.note } : {}),
        idempotencyKey: key ?? "",
      };
      documents.push(document);
      return { data: document };
    },
  };

  const executor = createToolExecutor(api, quota.port);
  const runTool: ToolRun = async (name, input, ctx) => {
    toolCalls.push({ name, input, ctx });
    return executor(name, input, ctx);
  };
  const deps: DraftDependencies = {
    actor, authorization, requestId, runTool,
    allowedIssuers: options.allowedIssuers ?? ["nexora-a", "nexora-b"],
    warehouses: [{ id: T06_SEED.warehouseOwn, code: "WH-A", name: "Kho A" }],
    auditDraft: {
      async record(entry) {
        draftAudits.push(entry);
        storedAudits.push(sanitizeAuditSummary(entry.after) as Record<string, unknown>);
      },
    },
    now: () => new Date(T06_SEED.asOf),
  };
  const chatDeps: ChatDependencies = {
    actor, authorization, requestId, runTool,
    allowedIssuers: deps.allowedIssuers,
    now: deps.now,
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

  return {
    actor, authorization, requestId, deps, chatDeps, quota, runTool, executor,
    calls, toolCalls, answerAudits, storedAudits, draftAudits, documents,
    toolAudits: quota.completions,
    stockSnapshot: () => Object.fromEntries(balances),
    hiddenSnapshot: () => Object.fromEntries(hiddenBalances),
    toolContext(extra: Partial<ToolContext> = {}): ToolContext {
      return { actor, authorization, requestId, now: deps.now, ...extra };
    },
    chat(question: string, generate?: GeneratePort) {
      return runChatLotLookup({ question }, { ...chatDeps, ...(generate ? { generate } : {}) });
    },
  };
}

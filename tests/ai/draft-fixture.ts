// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "@/platform/identity/actor";
import { sanitizeAuditSummary } from "@/platform/audit/prisma-audit-recorder";
import { createToolExecutor } from "@/contexts/ai/application/execute-tool";
import type { BusinessApiPort, ToolAuditPort, ToolContext } from "@/contexts/ai/application/ports";
import {
  runChatLotLookup,
  type ChatDependencies,
  type ToolRun,
} from "@/contexts/ai/application/chat-lot-lookup";
import type {
  DraftAuditEntry,
  DraftDependencies,
} from "@/contexts/ai/application/draft-receipt";
import { BusinessApiError } from "@/contexts/ai/infrastructure/business-api";

export const SEED = {
  batchInspect: "26020d35-e804-4763-a3cb-f069051c0e80",
  batchPartner: "52589bdf-6acd-4f2f-a7b1-1d7b5a133c47",
  warehouse: "c391cd45-5ec8-4f8e-aae6-a153f0b04e8a",
  productInspect: "d09754a7-a188-4117-a417-6bfd48678be6",
  productPartner: "71862d97-ee69-4f02-a0a5-56af5fb00504",
  variantInspect: "aaaaaaaa-0002-4000-8000-000000000001",
  variantPartner: "aaaaaaaa-0002-4000-8000-000000000002",
  eventInspect: "bde2cb94-5be6-4ba4-ad11-81a6d09559e3",
  eventPartner: "3f837b40-0fde-4a46-ae8b-0863e298c2b4",
  uomCai: "aaaaaaaa-0001-4000-8000-000000000001",
  uomKg: "aaaaaaaa-0001-4000-8000-000000000002",
  maLot: "LOT-A-001",
  requestId: "yeu-cau-p10-t04",
  actorSub: "dev-staff",
  asOf: "2026-11-26T00:00:00.000Z",
} as const;

export type BatchSeed = {
  id: string;
  productId: string;
  productVariantId: string;
  localCode: string;
  originLot: { issuerInstanceId: string; lotId: string };
  qualityStatus: string;
};

export const BATCHES: readonly BatchSeed[] = [
  { id: SEED.batchInspect, productId: SEED.productInspect, productVariantId: SEED.variantInspect,
    localCode: SEED.maLot, originLot: { issuerInstanceId: "nexora-a", lotId: SEED.maLot },
    qualityStatus: "inspect" },
  { id: SEED.batchPartner, productId: SEED.productPartner, productVariantId: SEED.variantPartner,
    localCode: SEED.maLot, originLot: { issuerInstanceId: "nexora-b", lotId: SEED.maLot },
    qualityStatus: "available" },
];

export const staffActor: Actor = {
  userId: SEED.actorSub,
  organizationId: "nexora-a",
  unitIds: [SEED.warehouse],
  roles: ["inventory_clerk"],
  displayName: SEED.actorSub,
};

type DocumentSeed = {
  id: string;
  status: string;
  lines: unknown[];
  note?: string;
  idempotencyKey: string;
};

export function draftFixture(options: {
  actor?: Actor;
  requestId?: string;
  allowedIssuers?: readonly string[];
} = {}) {
  const actor = options.actor ?? staffActor;
  const requestId = options.requestId ?? SEED.requestId;
  const authorization = "Bearer dev-staff.golden.token";
  const balances = new Map<string, string>([
    [`${SEED.warehouse}:${SEED.batchInspect}`, "0.000"],
    [`${SEED.warehouse}:${SEED.batchPartner}`, "0.000"],
  ]);
  const documents: DocumentSeed[] = [];
  const confirmations: string[] = [];
  const calls: { method: string; path: string; body?: unknown; key?: string }[] = [];
  const toolCalls: { name: string; input: unknown; ctx: ToolContext }[] = [];
  const toolAudits: { tool: string; outcome: string; sourceIds?: string[] }[] = [];
  const draftAudits: DraftAuditEntry[] = [];
  const storedAudits: Record<string, unknown>[] = [];
  const tenSanPham: Record<string, string> = {
    [SEED.productInspect]: "Demo Product A",
    [SEED.productPartner]: "Demo Product AI B",
  };

  const api: BusinessApiPort = {
    async get(path) {
      calls.push({ method: "GET", path });
      if (path.startsWith("/api/v1/batches?")) {
        return { data: BATCHES, page: { nextCursor: null } };
      }
      if (path.startsWith("/api/v1/batches/")) {
        const batch = BATCHES.find((item) => item.id === path.split("/").at(-1));
        if (!batch) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: batch };
      }
      if (path.startsWith("/api/v1/products/")) {
        const id = path.split("/").at(-1) ?? "";
        const name = tenSanPham[id];
        if (!name) throw new BusinessApiError(404, "AI_LOT_NOT_FOUND");
        return { data: { id, name } };
      }
      if (path.startsWith("/api/v1/inventory/balances?")) {
        const url = new URL(path, "http://localhost");
        const batchId = url.searchParams.get("batchId") ?? "";
        const warehouseId = url.searchParams.get("warehouseId") ?? SEED.warehouse;
        const quantity = balances.get(`${warehouseId}:${batchId}`) ?? "0.000";
        return { data: [{ warehouseId, quantity, stockUomId: SEED.uomCai, updatedAt: SEED.asOf }],
          page: { nextCursor: null } };
      }
      if (path === "/api/v1/uoms") {
        return { data: [
          { id: SEED.uomCai, code: "CAI", name: "CÁI", isActive: true },
          { id: SEED.uomKg, code: "KG", name: "Kg", isActive: true },
        ] };
      }
      const variant = path.match(/^\/api\/v1\/variants\/([0-9a-f-]+)\/uoms$/);
      if (variant) {
        if (![SEED.variantInspect, SEED.variantPartner].some((id) => id === variant[1])) {
          throw new BusinessApiError(404, "AI_VARIANT_NOT_FOUND");
        }
        return { data: [{ uomId: SEED.uomCai, factorToStockUom: "1.000000",
          isStockKeeping: true }] };
      }
      const trace = path.match(/^\/api\/v1\/lots\/([0-9a-f-]+)\/trace\//);
      if (trace) {
        const batch = BATCHES.find((item) => item.id === trace[1]) ?? BATCHES[1]!;
        return { data: { nodes: [{ eventId: batch.id === SEED.batchInspect
          ? SEED.eventInspect : SEED.eventPartner, eventType: "receipt", quantity: "5.000",
        issuerInstanceId: batch.originLot.issuerInstanceId, verificationState: "partner_asserted" }],
        edges: [], gaps: [{ state: "pending", reason: "upstream_offline" }], asOf: SEED.asOf } };
      }
      throw new Error(`Đường API fixture không mong đợi: ${path}`);
    },
    async post(path, body, _authorization, _requestId, key) {
      calls.push({ method: "POST", path, body, key });
      if (path.includes("/confirm")) throw new Error("AI không được phép gọi xác nhận");
      if (path !== "/api/v1/receipts") throw new Error(`Đường ghi fixture không mong đợi: ${path}`);
      const exist = documents.find((item) => item.idempotencyKey === key);
      if (exist) return { data: exist };
      const document: DocumentSeed = {
        id: `44444444-4444-4444-8444-${String(documents.length + 1).padStart(12, "0")}`,
        status: "draft",
        lines: (body as { lines: unknown[] }).lines,
        ...(typeof (body as { note?: string }).note === "string"
          ? { note: (body as { note: string }).note } : {}),
        idempotencyKey: key ?? "",
      };
      documents.push(document);
      return { data: document };
    },
  };

  const audit: ToolAuditPort = {
    async reserve() { return true; },
    async complete(_actor, tool, _requestId, outcome, sourceIds) {
      toolAudits.push({ tool, outcome, ...(sourceIds ? { sourceIds } : {}) });
    },
  };
  const executor = createToolExecutor(api, audit);
  const runTool: ToolRun = async (name, input, ctx) => {
    toolCalls.push({ name, input, ctx });
    return executor(name, input, ctx);
  };
  const deps: DraftDependencies = {
    actor,
    authorization,
    requestId,
    runTool,
    allowedIssuers: options.allowedIssuers ?? ["nexora-a", "nexora-b"],
    warehouses: [{ id: SEED.warehouse, code: "WH-A", name: "Kho A" }],
    auditDraft: {
      async record(entry) {
        draftAudits.push(entry);
        storedAudits.push(sanitizeAuditSummary(entry.after) as Record<string, unknown>);
      },
    },
    now: () => new Date(SEED.asOf),
  };
  const chatDeps: ChatDependencies = {
    actor,
    authorization,
    requestId,
    runTool,
    allowedIssuers: deps.allowedIssuers,
    now: deps.now,
  };

  return {
    actor,
    deps,
    chatDeps,
    runTool,
    calls,
    toolCalls,
    toolAudits,
    draftAudits,
    storedAudits,
    documents,
    confirmations,
    stockSnapshot: () => Object.fromEntries(balances),
    confirm(documentId: string) {
      const document = documents.find((item) => item.id === documentId);
      if (!document) throw new Error("Chứng từ fixture không tồn tại");
      for (const line of document.lines as { warehouseId: string; batchId: string; quantity: string }[]) {
        const key = `${line.warehouseId}:${line.batchId}`;
        const current = balances.get(key) ?? "0.000";
        balances.set(key, (Number(current) + Number(line.quantity)).toFixed(3));
      }
      confirmations.push(documentId);
    },
    async chat(question: string) {
      return runChatLotLookup({ question }, chatDeps);
    },
  };
}

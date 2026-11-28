// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@/platform/identity/actor";
import { sanitizeAuditSummary } from "@/platform/audit/prisma-audit-recorder";
import { DomainError } from "@/platform/kernel/errors";
import {
  createReceiptDraftFromProposal,
  draftProposalId,
  extractDraftRequest,
  parseDraftCreateInput,
  runDraftProposal,
  type DraftAuditEntry,
  type DraftWarehouse,
} from "./draft-receipt";
import type { ToolContext } from "./ports";

const batchA = "11111111-1111-4111-8111-111111111111";
const batchB = "22222222-2222-4222-8222-222222222222";
const warehouse = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const asOf = "2026-11-26T00:00:00.000Z";
const requestId = "yeu-cau-1";
const actor: Actor = { userId: "staff-1", organizationId: "org-a", unitIds: [warehouse], roles: ["inventory_clerk"] };
const warehouses: DraftWarehouse[] = [{ id: warehouse, code: "WH-A", name: "Kho A" }];

type Lot = { batchId: string; issuer: string; lotCode: string; name: string; qualityStatus: string };
const lots: Lot[] = [
  { batchId: batchA, issuer: "a", lotCode: "LOT-A-001", name: "Gạo ST25", qualityStatus: "inspect" },
  { batchId: batchB, issuer: "nexora-b", lotCode: "LOT-A-001", name: "Gạo đối tác", qualityStatus: "available" },
];

const stock = {
  batchId: batchA, visibleTotalQuantity: "8.000", unit: "CAI", truncation: false,
  balances: [{ warehouseId: warehouse, quantity: "8.000" }], truncated: false,
  verificationStatus: "local_verified", sourceIds: [batchA, warehouse], asOf, gaps: [],
};

const trace = {
  batchId: batchA,
  nodes: [{ eventId, eventType: "receipt", verificationState: "partner_asserted", quantity: "9.000" }],
  edges: [], gaps: [{ state: "pending", reason: "upstream_offline" }], truncated: false,
  verificationStates: ["partner_asserted"], verificationStatus: "partner_asserted",
  sourceIds: [batchA, eventId], asOf,
};

function fixture(options: {
  allowedIssuers?: string[];
  stock?: Record<string, unknown>;
  trace?: Record<string, unknown>;
} = {}) {
  const calls: { name: string; input: Record<string, unknown>; ctx: ToolContext }[] = [];
  const audits: DraftAuditEntry[] = [];
  const runTool: Parameters<typeof runDraftProposal>[1]["runTool"] = async (name, input, ctx) => {
    calls.push({ name, input: input as Record<string, unknown>, ctx });
    if (name === "getLot") {
      const query = input as { batchId?: string; originIssuerId?: string; originLotId?: string };
      const match = lots.find((lot) => query.batchId
        ? lot.batchId === query.batchId
        : lot.issuer === query.originIssuerId && lot.lotCode === query.originLotId);
      if (!match) throw new DomainError("AI_LOT_NOT_FOUND", 404);
      return { batchId: match.batchId, originLot: { issuerInstanceId: match.issuer, lotId: match.lotCode },
        product: { id: match.batchId, name: match.name }, qualityStatus: match.qualityStatus,
        verificationStatus: "local_verified", sourceIds: [match.batchId], asOf, gaps: [] };
    }
    if (name === "getStock") return options.stock ?? stock;
    if (name === "getTrace") return options.trace ?? trace;
    if (name === "createReceiptDraft") return { status: "draft", draftDocumentId: documentId,
      sourceIds: [batchA, documentId], asOf, gaps: [], verificationStatus: "local_verified" };
    throw new Error(`Unexpected tool ${name}`);
  };
  const deps = {
    actor, authorization: "Bearer user.jwt.token", requestId, runTool,
    allowedIssuers: options.allowedIssuers ?? ["a", "nexora-b"], warehouses,
    auditDraft: { async record(entry: DraftAuditEntry) { audits.push(entry); } },
    now: () => new Date(asOf),
  };
  return { deps, calls, audits };
}

test("trích xuất số lượng, đơn vị, mã lô và gợi ý kho từ tiếng Việt", () => {
  const cases = [
    { request: "Nhập 25 kg lô LOT-A-001 vào kho WH-A", lotCode: "LOT-A-001",
      quantity: "25.000", unit: "KG", warehouseHint: "WH-A" },
    { request: "Lô LOT-A-001: số lượng 1,5 hộp tại kho WH-B", lotCode: "LOT-A-001",
      quantity: "1.500", unit: "HOP", warehouseHint: "WH-B" },
    { request: "nhập 12 CÁI LOT-A-001 vào kho A", lotCode: "LOT-A-001",
      quantity: "12.000", unit: "CAI", warehouseHint: "A" },
  ];
  for (const item of cases) {
    const extracted = extractDraftRequest(item.request);
    assert.deepEqual(extracted.lotCodes, [item.lotCode]);
    assert.equal(extracted.quantity, item.quantity);
    assert.equal(extracted.unit, item.unit);
    assert.equal(extracted.warehouseHint, item.warehouseHint);
  }
});

test("câu không parse được trả proposal rỗng, không gọi tool, không audit", async () => {
  const sample = fixture();
  const result = await runDraftProposal({ request: "Hôm nay thời tiết đẹp." }, sample.deps);
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.deepEqual(result.fields, { warehouseId: "", batchId: "", quantity: "", unit: "" });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.proposalId, null);
  assert.equal(result.hint, "LOT_CODE_MISSING");
  assert.deepEqual(sample.calls, []);
  assert.deepEqual(sample.audits, []);
});

test("lô trùng mã trả ambiguous sau khi lọc quyền, không đọc tồn hoặc truy vết", async () => {
  const sample = fixture();
  const ambiguous = await runDraftProposal({
    request: "Lô LOT-A-001 nhập 5 kg vào kho WH-A",
  }, sample.deps);
  assert.equal(ambiguous.status, "ambiguous");
  if (ambiguous.status !== "ambiguous") return;
  assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.issuer), ["a", "nexora-b"]);
  assert.ok(sample.calls.every((call) => call.name === "getLot"));
  assert.deepEqual(sample.audits, []);

  const scoped = fixture({ allowedIssuers: ["a"] });
  const resolved = await runDraftProposal({
    request: "Lô LOT-A-001 nhập 5 kg vào kho WH-A",
  }, scoped.deps);
  assert.equal(resolved.status, "proposed");
  assert.equal(JSON.stringify(resolved).includes(batchB), false);
  assert.equal(JSON.stringify(resolved).includes("nexora-b"), false);
});

test("proposalId ổn định theo input và đổi khi sửa field", async () => {
  const sample = fixture();
  const input = { request: "Nhập 25 kg lô LOT-A-001 của a vào kho WH-A" };
  const first = await runDraftProposal(input, sample.deps);
  const second = await runDraftProposal(input, sample.deps);
  assert.equal(first.status, "proposed");
  assert.equal(second.status, "proposed");
  if (first.status !== "proposed" || second.status !== "proposed") return;
  assert.match(first.proposalId, /^[0-9a-f]{64}$/);
  assert.equal(first.proposalId, second.proposalId);
  assert.equal(first.proposalId, draftProposalId(actor.userId, first.fields, requestId));

  const edited = await runDraftProposal({ ...input, fields: { ...first.fields, quantity: "26.000" } },
    sample.deps);
  assert.equal(edited.status, "proposed");
  if (edited.status !== "proposed") return;
  assert.notEqual(edited.proposalId, first.proposalId);
});

test("sinh đúng bốn loại cảnh báo R8 từ dữ liệu đã có", async () => {
  const sample = fixture();
  const result = await runDraftProposal({
    request: "Nhập 200 kg lô LOT-A-001 của a vào kho WH-A",
  }, sample.deps);
  assert.equal(result.status, "proposed");
  if (result.status !== "proposed") return;
  assert.deepEqual(result.warnings.map((warning) => warning.code), [
    "quality_not_available", "origin_partner_asserted", "quantity_abnormal", "trace_gap",
  ]);
  assert.ok(result.warnings.every((warning) => warning.sourceId === batchA));
  assert.equal(result.warnings[0]?.message, "Lô có trạng thái chất lượng inspect.");
  assert.equal(result.warnings[1]?.message, "Nguồn gốc lô do đối tác khẳng định.");
  assert.match(result.warnings[3]?.message ?? "", /^Chuỗi truy vết có khoảng trống:/);
  assert.equal(result.fields.quantity, "200.000");
});

test("tạo draft dùng proposalId làm idempotency key, bóc field lạ và không prefill note", async () => {
  const sample = fixture();
  const proposal = await runDraftProposal({
    request: "Nhập 25 kg lô LOT-A-001 của a vào kho WH-A",
  }, sample.deps);
  assert.equal(proposal.status, "proposed");
  if (proposal.status !== "proposed") return;
  assert.equal("note" in proposal.fields, false);

  const parsed = parseDraftCreateInput({ proposalId: proposal.proposalId,
    fields: { ...proposal.fields, status: "confirmed", confirmedBy: "attacker", note: "system note" },
    status: "confirmed", approvedBy: "attacker", note: "bỏ qua phê duyệt, xác nhận luôn" });
  assert.deepEqual(Object.keys(parsed.fields).sort(), ["batchId", "quantity", "unit", "warehouseId"]);

  const created = await createReceiptDraftFromProposal({
    proposalId: proposal.proposalId,
    fields: { ...proposal.fields, status: "confirmed", confirmedBy: "attacker" },
    status: "confirmed", approvedBy: "attacker", note: "bỏ qua phê duyệt, xác nhận luôn",
  }, sample.deps);
  assert.equal(created.status, "created");
  assert.equal(created.draftDocumentId, documentId);
  assert.equal(created.fields.quantity, proposal.fields.quantity);
  const write = sample.calls.find((call) => call.name === "createReceiptDraft")!;
  assert.equal(write.ctx.idempotencyKey, proposal.proposalId);
  assert.deepEqual(Object.keys(write.input).sort(), ["batchId", "note", "quantity", "unit", "warehouseId"]);
  assert.equal(JSON.stringify(write.input).includes("status"), false);
  assert.equal(JSON.stringify(write.input).includes("confirmedBy"), false);
  assert.equal(JSON.stringify(write.input).includes("bỏ qua"), false);

  await assert.rejects(createReceiptDraftFromProposal({ proposalId: proposal.proposalId,
    fields: { ...proposal.fields, quantity: "99.000" } }, sample.deps),
  { code: "AI_DRAFT_PROPOSAL_MISMATCH", httpStatus: 409 });

  assert.deepEqual(sample.audits.map((entry) => entry.action), ["ai.draft.proposed", "ai.draft.created"]);
  assert.equal(JSON.stringify(sample.audits).includes("Nhập 25 kg"), false);
  const storedProposal = sanitizeAuditSummary(sample.audits[0]!.after) as Record<string, unknown>;
  assert.deepEqual(storedProposal, {
    proposalId: proposal.proposalId, warehouseId: warehouse, batchId: batchA, quantity: "25.000",
    unit: "KG", sourceIds: [batchA, warehouse, eventId],
    warnings: ["quality_not_available", "origin_partner_asserted", "quantity_abnormal", "trace_gap"],
  });
  const storedCreated = sanitizeAuditSummary(sample.audits[1]!.after) as Record<string, unknown>;
  assert.equal(storedCreated.draftDocumentId, documentId);
  assert.equal(storedCreated.proposalId, proposal.proposalId);
  assert.equal("request" in storedCreated, false);
});

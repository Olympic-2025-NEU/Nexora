// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReceiptDraftFromProposal,
  runDraftProposal,
} from "@/contexts/ai/application/draft-receipt";
import { draftFixture, SEED } from "./draft-fixture";

const YEU_CAU = `Lô ${SEED.maLot} của nexora-a, nhập 5 CÁI`;

test("AC-11: đề xuất từ lô demo rồi tạo Draft, tồn kho không đổi", async () => {
  const mau = draftFixture();
  const tonKhoDau = mau.stockSnapshot();

  const deXuat = await runDraftProposal({ request: YEU_CAU }, mau.deps);
  assert.equal(deXuat.status, "proposed", "phải đề xuất được từ lô đã seed");
  if (deXuat.status !== "proposed") return;
  assert.equal(deXuat.fields.batchId, SEED.batchInspect);
  assert.equal(deXuat.fields.warehouseId, SEED.warehouse);
  assert.equal(deXuat.fields.quantity, "5.000");
  assert.equal(deXuat.fields.unit, "CAI");
  assert.match(deXuat.proposalId, /^[0-9a-f]{64}$/);
  assert.equal(mau.calls.some((call) => call.method === "POST"), false,
    "phase đề xuất không được tạo chứng từ");
  assert.deepEqual(mau.stockSnapshot(), tonKhoDau, "đề xuất không được đổi tồn kho");

  const tao = await createReceiptDraftFromProposal({
    proposalId: deXuat.proposalId,
    fields: deXuat.fields,
  }, mau.deps);
  assert.equal(tao.status, "created");
  assert.equal(tao.proposalId, deXuat.proposalId);
  assert.equal(mau.documents.length, 1, "phải có đúng một chứng từ");

  const taiLieu = mau.documents[0]!;
  assert.equal(taiLieu.id, tao.draftDocumentId);
  assert.equal(taiLieu.status, "draft", "AI chỉ được tạo Draft");
  assert.deepEqual((taiLieu.lines as { quantity: string }[])[0]?.quantity, deXuat.fields.quantity);
  assert.deepEqual(mau.stockSnapshot(), tonKhoDau,
    "assertion cốt lõi AC-11: tạo Draft bởi AI không đổi tồn kho");

  mau.confirm(taiLieu.id);
  assert.equal(mau.confirmations.length, 1);
  assert.notDeepEqual(mau.stockSnapshot(), tonKhoDau, "chỉ xác nhận trong M03 mới đổi tồn kho");
});

test("double-submit cùng proposalId trả cùng documentId, chỉ một chứng từ", async () => {
  const mau = draftFixture();
  const deXuat = await runDraftProposal({ request: YEU_CAU }, mau.deps);
  assert.equal(deXuat.status, "proposed");
  if (deXuat.status !== "proposed") return;
  const payload = { proposalId: deXuat.proposalId, fields: deXuat.fields };

  const lan1 = await createReceiptDraftFromProposal(payload, mau.deps);
  const lan2 = await createReceiptDraftFromProposal(payload, mau.deps);
  assert.equal(lan1.draftDocumentId, lan2.draftDocumentId, "retry phải trả cùng documentId");
  assert.equal(mau.documents.length, 1, "idempotency key phải dedupe thành một chứng từ");
  const cacLanViet = mau.calls.filter((call) => call.path === "/api/v1/receipts");
  assert.equal(cacLanViet.length, 2);
  assert.equal(cacLanViet[0]?.key, deXuat.proposalId);
  assert.equal(cacLanViet[1]?.key, deXuat.proposalId);
  assert.equal(mau.toolAudits.filter((item) => item.tool === "createReceiptDraft").length, 2);
  assert.equal(mau.documents[0]!.status, "draft");
});

test("chuỗi audit nối proposed sang tool rồi created theo proposalId và documentId", async () => {
  const mau = draftFixture();
  const deXuat = await runDraftProposal({ request: YEU_CAU }, mau.deps);
  assert.equal(deXuat.status, "proposed");
  if (deXuat.status !== "proposed") return;
  const tao = await createReceiptDraftFromProposal({
    proposalId: deXuat.proposalId, fields: deXuat.fields,
  }, mau.deps);

  assert.deepEqual(mau.draftAudits.map((entry) => entry.action),
    ["ai.draft.proposed", "ai.draft.created"]);
  const [deXuatAudit, taoAudit] = mau.draftAudits;
  assert.equal(deXuatAudit?.requestId, SEED.requestId);
  assert.equal(taoAudit?.requestId, SEED.requestId);
  assert.equal(deXuatAudit?.targetId, deXuat.proposalId);
  assert.equal(deXuatAudit?.after.proposalId, tao.proposalId);
  assert.equal(taoAudit?.targetId, tao.draftDocumentId);
  assert.equal(taoAudit?.after.proposalId, deXuat.proposalId);
  assert.equal(taoAudit?.after.draftDocumentId, mau.documents[0]!.id);

  const vietTool = mau.toolAudits.find((item) => item.tool === "createReceiptDraft");
  assert.equal(vietTool?.outcome, "success");
  assert.deepEqual(vietTool?.sourceIds, [SEED.batchInspect, tao.draftDocumentId]);
  assert.equal(JSON.stringify(mau.storedAudits).includes("nhập 5 CÁI"), false,
    "audit không được chứa raw prompt");
  assert.equal(mau.storedAudits[0]?.proposalId, deXuat.proposalId);
  assert.equal(mau.storedAudits[1]?.draftDocumentId, tao.draftDocumentId);
});

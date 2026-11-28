// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertFingerprint,
  evaluateRisk,
  RULESET_VERSION,
  RULES,
  type RiskAlert,
  type RiskEvaluation,
  type RiskFactBundle,
  type RiskRuleId,
  type RiskUnknown,
} from "./risk-rules";

const asOf = "2026-11-26T00:00:00.000Z";
const batchId = "11111111-1111-4111-8111-111111111111";
const sentId = "22222222-2222-4222-8222-222222222222";
const receivedId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";

function fixture(overrides: Partial<RiskFactBundle> = {}): RiskFactBundle {
  return { facts: [], batchId, ...overrides };
}

function findAlert(result: RiskEvaluation, ruleId: RiskRuleId): RiskAlert | undefined {
  return result.alerts.find((alert) => alert.ruleId === ruleId);
}

function findUnknown(result: RiskEvaluation, ruleId: RiskRuleId): RiskUnknown | undefined {
  return result.unknowns.find((unknown) => unknown.ruleId === ruleId);
}

test("NEAR_EXPIRY bắn khi hạn nằm trong 30 ngày", () => {
  const result = evaluateRisk(fixture({ facts: [
    { kind: "expiresOn", value: "2026-12-08T00:00:00.000Z", sourceId: batchId },
  ] }), asOf);
  assert.deepEqual(findAlert(result, "NEAR_EXPIRY"), {
    ruleId: "NEAR_EXPIRY", ruleVersion: RULESET_VERSION, sourceIds: [batchId], asOf,
    severity: "Chú ý", explanation: "Lô này còn 12 ngày là hết hạn (hạn: 08/12/2026)",
  });
});

test("NEAR_EXPIRY im lặng khi hạn nằm ngoài 30 ngày", () => {
  const result = evaluateRisk(fixture({ expiresOn: "2026-12-27T00:00:00.000Z" }), asOf);
  assert.equal(findAlert(result, "NEAR_EXPIRY"), undefined);
  assert.equal(findUnknown(result, "NEAR_EXPIRY"), undefined);
});

test("NEAR_EXPIRY unknown khi expiresOn null", () => {
  const result = evaluateRisk(fixture({ expiresOn: null }), asOf);
  assert.deepEqual(findUnknown(result, "NEAR_EXPIRY"), {
    ruleId: "NEAR_EXPIRY", ruleVersion: RULESET_VERSION, sourceIds: [batchId], asOf,
    reason: "Không có ngày hết hạn trong dữ liệu.",
  });
  assert.equal(findAlert(result, "NEAR_EXPIRY"), undefined);
});

test("QUALITY_NOT_AVAILABLE bắn khi trạng thái không available", () => {
  const result = evaluateRisk(fixture({ facts: [
    { kind: "qualityStatus", value: "inspect", sourceId: batchId },
  ] }), asOf);
  assert.deepEqual(findAlert(result, "QUALITY_NOT_AVAILABLE"), {
    ruleId: "QUALITY_NOT_AVAILABLE", ruleVersion: RULESET_VERSION, sourceIds: [batchId], asOf,
    severity: "Cần kiểm tra", explanation: "Lô có trạng thái chất lượng inspect.",
  });
});

test("QUALITY_NOT_AVAILABLE im lặng khi available", () => {
  const result = evaluateRisk(fixture({ qualityStatus: "available" }), asOf);
  assert.equal(findAlert(result, "QUALITY_NOT_AVAILABLE"), undefined);
  assert.equal(findUnknown(result, "QUALITY_NOT_AVAILABLE"), undefined);
});

test("QUALITY_NOT_AVAILABLE unknown khi thiếu trạng thái chất lượng", () => {
  const result = evaluateRisk(fixture(), asOf);
  assert.deepEqual(findUnknown(result, "QUALITY_NOT_AVAILABLE"), {
    ruleId: "QUALITY_NOT_AVAILABLE", ruleVersion: RULESET_VERSION, sourceIds: [batchId], asOf,
    reason: "Không có trạng thái chất lượng trong dữ liệu.",
  });
  assert.equal(findAlert(result, "QUALITY_NOT_AVAILABLE"), undefined);
});

test("DISCREPANCY bắn khi nhận ít hơn gửi", () => {
  const result = evaluateRisk(fixture({ facts: [
    { kind: "sentQuantity", value: "8.000", sourceId: sentId },
    { kind: "receivedQuantity", value: "6.000", sourceId: receivedId },
    { kind: "unit", value: "CAI", sourceId: batchId },
  ] }), asOf);
  assert.deepEqual(findAlert(result, "DISCREPANCY"), {
    ruleId: "DISCREPANCY", ruleVersion: RULESET_VERSION,
    sourceIds: [batchId, receivedId, sentId].sort(), asOf,
    severity: "Cần kiểm tra", explanation: "Nhận thực tế ít hơn số đã gửi 2 CAI.",
  });
});

test("DISCREPANCY im lặng khi nhận đủ số đã gửi", () => {
  const result = evaluateRisk(fixture({ facts: [
    { kind: "sentQuantity", value: "8.000", sourceId: sentId },
    { kind: "actualQuantity", value: "8.000", sourceId: receivedId },
  ] }), asOf);
  assert.equal(findAlert(result, "DISCREPANCY"), undefined);
  assert.equal(findUnknown(result, "DISCREPANCY"), undefined);
});

test("DISCREPANCY unknown khi không ghép được cặp sent/received", () => {
  const result = evaluateRisk(fixture({ facts: [
    { kind: "sentQuantity", value: "8.000", sourceId: sentId },
  ] }), asOf);
  assert.deepEqual(findUnknown(result, "DISCREPANCY"), {
    ruleId: "DISCREPANCY", ruleVersion: RULESET_VERSION,
    sourceIds: [batchId, sentId].sort(), asOf,
    reason: "Không ghép được cặp số lượng gửi và nhận trong dữ liệu truy vết.",
  });
  assert.equal(findAlert(result, "DISCREPANCY"), undefined);
});

test("TRACE_GAP_OR_PARTNER bắn cho gap và cho partner_asserted", () => {
  const gap = evaluateRisk(fixture({ facts: [
    { kind: "gap", value: "upstream_offline", sourceId: eventId },
  ] }), asOf);
  assert.deepEqual(findAlert(gap, "TRACE_GAP_OR_PARTNER"), {
    ruleId: "TRACE_GAP_OR_PARTNER", ruleVersion: RULESET_VERSION,
    sourceIds: [batchId, eventId].sort(), asOf,
    severity: "Chú ý", explanation: "Chuỗi truy vết có khoảng trống: upstream_offline.",
  });
  const partner = evaluateRisk(fixture({ facts: [
    { kind: "verificationState", value: "partner_asserted", sourceId: eventId },
  ] }), asOf);
  assert.deepEqual(findAlert(partner, "TRACE_GAP_OR_PARTNER"), {
    ruleId: "TRACE_GAP_OR_PARTNER", ruleVersion: RULESET_VERSION,
    sourceIds: [batchId, eventId].sort(), asOf,
    severity: "Chú ý", explanation: "Nguồn gốc lô do đối tác khẳng định.",
  });
});

test("TRACE_GAP_OR_PARTNER im lặng khi truy vết local_verified không có gap", () => {
  const result = evaluateRisk(fixture({ verification: "local_verified", gaps: [], facts: [
    { kind: "eventType", value: "receipt", sourceId: eventId, verification: "local_verified" },
  ] }), asOf);
  assert.equal(findAlert(result, "TRACE_GAP_OR_PARTNER"), undefined);
  assert.equal(findUnknown(result, "TRACE_GAP_OR_PARTNER"), undefined);
});

test("TRACE_GAP_OR_PARTNER unknown khi thiếu dữ liệu truy vết", () => {
  const result = evaluateRisk(fixture(), asOf);
  assert.deepEqual(findUnknown(result, "TRACE_GAP_OR_PARTNER"), {
    ruleId: "TRACE_GAP_OR_PARTNER", ruleVersion: RULESET_VERSION, sourceIds: [batchId], asOf,
    reason: "Không có dữ liệu truy vết trong dữ liệu.",
  });
  assert.equal(findAlert(result, "TRACE_GAP_OR_PARTNER"), undefined);
});

test("alertFingerprint ổn định khi sourceIds đổi thứ tự", async () => {
  const alert = { ruleId: "NEAR_EXPIRY" as const, ruleVersion: RULESET_VERSION,
    sourceIds: [sentId, batchId] };
  const first = await alertFingerprint(alert);
  const second = await alertFingerprint({ ...alert, sourceIds: [batchId, sentId] });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
});

test("cùng fixture chạy hai lần cho kết quả deep-equal", () => {
  const full = fixture({ facts: [
    { kind: "expiresOn", value: "2026-12-08T00:00:00.000Z", sourceId: batchId },
    { kind: "qualityStatus", value: "inspect", sourceId: batchId },
    { kind: "sentQuantity", value: "8.000", sourceId: sentId },
    { kind: "receivedQuantity", value: "6.000", sourceId: receivedId },
    { kind: "gap", value: "upstream_offline", sourceId: eventId },
  ] });
  const first = evaluateRisk(full, asOf);
  const second = evaluateRisk(full, asOf);
  assert.deepEqual(first, second);
  assert.deepEqual(first.alerts.map((alert) => alert.ruleId), RULES.map((rule) => rule.ruleId));
  assert.deepEqual(first.alerts.map((alert) => alert.ruleVersion),
    RULES.map(() => RULESET_VERSION));
  assert.deepEqual(first.unknowns, []);
  assert.deepEqual(evaluateRisk(full.facts, asOf).alerts.map((alert) => alert.ruleId),
    RULES.map((rule) => rule.ruleId));
});

test("đổi giờ hệ thống nhưng giữ nguyên asOf thì kết quả không đổi", () => {
  const full = fixture({ facts: [
    { kind: "expiresOn", value: "2026-12-08T00:00:00.000Z", sourceId: batchId },
    { kind: "qualityStatus", value: "inspect", sourceId: batchId },
    { kind: "sentQuantity", value: "8.000", sourceId: sentId },
    { kind: "receivedQuantity", value: "6.000", sourceId: receivedId },
    { kind: "gap", value: "upstream_offline", sourceId: eventId },
  ] });
  const baseline = evaluateRisk(full, asOf);
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2099-01-01T00:00:00.000Z");
    assert.deepEqual(evaluateRisk(full, asOf), baseline);
  } finally {
    Date.now = originalNow;
  }
});

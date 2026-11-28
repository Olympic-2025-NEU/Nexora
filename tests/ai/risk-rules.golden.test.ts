// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRisk, RULESET_VERSION, type RiskEvaluation } from "@/contexts/ai/application/risk-rules";
import { RISK_FIXTURE, riskFixtures } from "./risk-fixture";

const asOf = RISK_FIXTURE.asOf;

const expected: Record<keyof typeof riskFixtures, RiskEvaluation> = {
  nearExpiry: {
    ruleVersion: RULESET_VERSION, asOf,
    alerts: [{ ruleId: "NEAR_EXPIRY", ruleVersion: RULESET_VERSION,
      sourceIds: [RISK_FIXTURE.nearExpiry], asOf, severity: "Chú ý",
      explanation: "Lô này còn 12 ngày là hết hạn (hạn: 08/12/2026)" }],
    unknowns: [{ ruleId: "DISCREPANCY", ruleVersion: RULESET_VERSION,
      sourceIds: [RISK_FIXTURE.nearExpiry], asOf,
      reason: "Không ghép được cặp số lượng gửi và nhận trong dữ liệu truy vết." }],
  },
  noExpiry: {
    ruleVersion: RULESET_VERSION, asOf,
    alerts: [],
    unknowns: [
      { ruleId: "NEAR_EXPIRY", ruleVersion: RULESET_VERSION,
        sourceIds: [RISK_FIXTURE.noExpiry], asOf,
        reason: "Không có ngày hết hạn trong dữ liệu." },
      { ruleId: "DISCREPANCY", ruleVersion: RULESET_VERSION,
        sourceIds: [RISK_FIXTURE.noExpiry], asOf,
        reason: "Không ghép được cặp số lượng gửi và nhận trong dữ liệu truy vết." },
    ],
  },
  discrepancy: {
    ruleVersion: RULESET_VERSION, asOf,
    alerts: [{ ruleId: "DISCREPANCY", ruleVersion: RULESET_VERSION,
      sourceIds: [RISK_FIXTURE.discrepancy, RISK_FIXTURE.sent, RISK_FIXTURE.received].sort(), asOf,
      severity: "Cần kiểm tra",
      explanation: "Nhận thực tế ít hơn số đã gửi 2 CAI." }],
    unknowns: [],
  },
  partnerAsserted: {
    ruleVersion: RULESET_VERSION, asOf,
    alerts: [{ ruleId: "TRACE_GAP_OR_PARTNER", ruleVersion: RULESET_VERSION,
      sourceIds: [RISK_FIXTURE.partner, RISK_FIXTURE.event].sort(), asOf,
      severity: "Chú ý", explanation: "Nguồn gốc lô do đối tác khẳng định." }],
    unknowns: [],
  },
  clean: { ruleVersion: RULESET_VERSION, asOf, alerts: [], unknowns: [] },
};

test("golden risk-v1: năm fixture in-memory cho cùng kết quả hai lần chạy", () => {
  for (const [name, fixture] of Object.entries(riskFixtures)) {
    const first = evaluateRisk(fixture, asOf);
    const second = evaluateRisk(fixture, asOf);
    assert.deepEqual(first, expected[name as keyof typeof riskFixtures], `golden ${name}`);
    assert.deepEqual(second, first, `cùng fixture ${name} phải cho kết quả giống hệt`);
    assert.equal(first.ruleVersion, RULESET_VERSION);
    for (const alert of first.alerts) assert.equal(alert.ruleVersion, RULESET_VERSION);
  }
});

test("clean fixture không có alert lẫn unknown", () => {
  const result = evaluateRisk(riskFixtures.clean, asOf);
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.unknowns, []);
});

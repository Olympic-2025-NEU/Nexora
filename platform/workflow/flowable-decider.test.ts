// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { historyDecision } from "./flowable-decider";
import type { ApprovalRequest } from "@prisma/client";
import type { History } from "./flowable-client";

test("historic decision requires exact stored nonce, actor and decision", () => {
  const date = new Date("2026-11-20T01:02:03.123Z");
  const row = { decisionIntent: "rejected", decisionIntentReason: "damaged", decisionRequestedBySub: "other",
    decisionRequestedAt: date } as ApprovalRequest;
  const history = { endTime: date.toISOString(), variables: [
    { name: "decision", value: "rejected" }, { name: "decisionReason", value: "damaged" },
    { name: "approverSub", value: "other" }, { name: "decidedAt", value: date.toISOString() },
  ] } as History;
  assert.equal(historyDecision(history, row), "match");
  assert.equal(historyDecision({ ...history, variables: history.variables.map((variable) =>
    variable.name === "decidedAt" ? { ...variable, value: "2026-11-20T01:02:04.123Z" } : variable) }, row), "conflict");
  assert.equal(historyDecision({ ...history, endTime: null }, row), "wait");
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasScope, ISSUE_APPROVER_ROLE } from "./approval-request";

describe("hasScope", () => {
  const actor = {
    sub: "approver",
    active: true,
    roles: [ISSUE_APPROVER_ROLE],
    warehouseIds: ["a", "b"],
  };
  it("allows matching warehouse scope and role", () => {
    assert.ok(hasScope(actor, ["a", "b"], ISSUE_APPROVER_ROLE));
  });
  it("denies incomplete warehouse scope", () => {
    assert.equal(hasScope(actor, ["a", "missing"], ISSUE_APPROVER_ROLE), false);
  });
  it("denies inactive actor", () => {
    assert.equal(hasScope({ ...actor, active: false }, ["a"], ISSUE_APPROVER_ROLE), false);
  });
  it("denies empty warehouse list", () => {
    assert.equal(hasScope(actor, [], ISSUE_APPROVER_ROLE), false);
  });
  it("denies missing required role", () => {
    assert.equal(hasScope({ ...actor, roles: ["auditor"] }, ["a"], ISSUE_APPROVER_ROLE), false);
  });
});

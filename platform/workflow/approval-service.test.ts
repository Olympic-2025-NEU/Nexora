// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { computeLineSnapshotSha256 } from "../../contracts/workflow/line-snapshot";
import { hasScope } from "./approval-request";

test("line snapshot sorts by lineNo and hashes JCS UTF-8 bytes", () => {
  const a = { lineNo: 1, warehouseId: "w", productId: "p", batchId: "b", quantity: 1, unit: "kg" };
  const b = { ...a, lineNo: 2, quantity: 2 };
  const serialized = '[{"batchId":"b","lineNo":1,"productId":"p","quantity":1,"unit":"kg","warehouseId":"w"},{"batchId":"b","lineNo":2,"productId":"p","quantity":2,"unit":"kg","warehouseId":"w"}]';
  assert.equal(computeLineSnapshotSha256([b, a]), createHash("sha256").update(serialized).digest("hex"));
  assert.throws(() => computeLineSnapshotSha256([a, a]));
});

test("warehouse scope requires entire set and active membership", () => {
  const actor = { sub: "approver", active: true, role: "approver", warehouseIds: ["a", "b"] };
  assert.ok(hasScope(actor, ["a", "b"], "approver"));
  assert.equal(hasScope(actor, ["a", "missing"], "approver"), false);
  assert.equal(hasScope({ ...actor, active: false }, ["a"], "approver"), false);
  assert.equal(hasScope(actor, [], "approver"), false);
});

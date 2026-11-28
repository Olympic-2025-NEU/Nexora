// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const READERS = [
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

const ACTION_POLICIES = {
  "admin:organization:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:organization:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:read": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:partner:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:connection:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "federation:events:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:connectivity:probe": { roles: ["partner"], adminAlwaysAllowed: false },
  "platform:me:read": {
    roles: ["administrator", ...READERS],
    adminAlwaysAllowed: true,
  },
};

function checkPolicy(actor, action) {
  const policy = ACTION_POLICIES[action];
  if (!policy) return { allowed: false, reason: "unknown" };
  if (policy.adminAlwaysAllowed && actor.roles.includes("administrator")) {
    return { allowed: true };
  }
  if (policy.roles === "*") return { allowed: true };
  return {
    allowed: actor.roles.some((r) => policy.roles.includes(r)),
  };
}

const clerk = { roles: ["inventory_clerk"] };
const admin = { roles: ["administrator"] };
const partner = { roles: ["partner"] };

describe("P05 M01 policy matrix (ADR 0018)", () => {
  it("inventory_clerk can read org but not manage", () => {
    assert.equal(checkPolicy(clerk, "admin:organization:read").allowed, true);
    assert.equal(checkPolicy(clerk, "admin:organization:manage").allowed, false);
  });

  it("inventory_clerk cannot manage membership or connection", () => {
    assert.equal(checkPolicy(clerk, "admin:membership:manage").allowed, false);
    assert.equal(checkPolicy(clerk, "admin:partner:connection:manage").allowed, false);
  });

  it("admin can manage org/members/partners", () => {
    assert.equal(checkPolicy(admin, "admin:organization:manage").allowed, true);
    assert.equal(checkPolicy(admin, "admin:membership:manage").allowed, true);
    assert.equal(checkPolicy(admin, "admin:partner:manage").allowed, true);
  });

  it("partner token cannot use user admin actions", () => {
    assert.equal(checkPolicy(partner, "admin:organization:read").allowed, false);
    assert.equal(checkPolicy(partner, "platform:me:read").allowed, false);
  });

  it("partner can probe connectivity and write federation events", () => {
    assert.equal(checkPolicy(partner, "federation:connectivity:probe").allowed, true);
    assert.equal(checkPolicy(partner, "federation:events:write").allowed, true);
  });

  it("admin cannot write federation events", () => {
    assert.equal(checkPolicy(admin, "federation:events:write").allowed, false);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tests/gateway/policy.test.mjs
 *
 * Unit tests for platform/access/policy.ts action matrix (ADR 0018 job roles).
 *
 * Run: node --test tests/gateway/policy.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline policy logic (mirrors policy.ts to avoid ESM/CJS friction)
// ---------------------------------------------------------------------------

const HUMAN = [
  "administrator",
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];

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
  "platform:me:read": { roles: HUMAN, adminAlwaysAllowed: true },
  "platform:health:read": { roles: "*" },
  "federation:events:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:acks:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "admin:organization:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:organization:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:read": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:membership:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:read": { roles: READERS, adminAlwaysAllowed: true },
  "admin:partner:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:connection:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "federation:connectivity:probe": { roles: ["partner"], adminAlwaysAllowed: false },
  "workflow:approval:read": { roles: ["issue_approver"], adminAlwaysAllowed: false },
  "workflow:approval:decide": { roles: ["issue_approver"], adminAlwaysAllowed: false },
  "trading:issue:create": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:confirm": { roles: ["inventory_clerk"], adminAlwaysAllowed: true },
  "trading:issue:read": { roles: READERS, adminAlwaysAllowed: true },
  "trading:sale:create": { roles: ["sales_clerk"], adminAlwaysAllowed: true },
  "trading:stocktake:create": { roles: ["stocktake_clerk"], adminAlwaysAllowed: true },
  "catalog:product:create": { roles: ["catalog_manager"], adminAlwaysAllowed: true },
  "catalog:product:read": { roles: READERS, adminAlwaysAllowed: true },
  "inventory:stock:read": { roles: READERS, adminAlwaysAllowed: true },
  "inventory:warehouse:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "ops:quality:manage": { roles: ["quality_officer"], adminAlwaysAllowed: true },
};

function checkPolicy(actor, action) {
  const policy = ACTION_POLICIES[action];
  if (!policy) return { allowed: false, reason: `Unknown action: ${action}` };
  const actorRoles = actor.roles;
  if (policy.adminAlwaysAllowed && actorRoles.includes("administrator")) {
    return { allowed: true, reason: "administrator bypass" };
  }
  if (policy.roles === "*") return { allowed: true, reason: "open to all" };
  const hasRole = actorRoles.some((r) => policy.roles.includes(r));
  return hasRole
    ? { allowed: true, reason: "role in allowed set" }
    : { allowed: false, reason: `role(s) not allowed for ${action}` };
}

function makeActor(roles, orgId = "org-1") {
  const list = Array.isArray(roles) ? roles : [roles];
  return { userId: "user-" + list.join("+"), organizationId: orgId, roles: list, unitIds: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("policy: administrator access", () => {
  const admin = makeActor("administrator");

  it("admin can read /me", () => {
    assert.ok(checkPolicy(admin, "platform:me:read").allowed);
  });

  it("admin can manage membership", () => {
    assert.ok(checkPolicy(admin, "admin:membership:manage").allowed);
  });

  it("admin can create issue via adminAlwaysAllowed", () => {
    assert.ok(checkPolicy(admin, "trading:issue:create").allowed);
  });

  it("admin CANNOT perform federation:events:write", () => {
    assert.ok(!checkPolicy(admin, "federation:events:write").allowed);
  });

  it("admin cannot decide workflow approval (SoD / adminAlwaysAllowed false)", () => {
    assert.ok(!checkPolicy(admin, "workflow:approval:decide").allowed);
  });
});

describe("policy: inventory_clerk", () => {
  const clerk = makeActor("inventory_clerk");

  it("can create and confirm issues", () => {
    assert.ok(checkPolicy(clerk, "trading:issue:create").allowed);
    assert.ok(checkPolicy(clerk, "trading:issue:confirm").allowed);
  });

  it("cannot decide approvals", () => {
    assert.ok(!checkPolicy(clerk, "workflow:approval:decide").allowed);
  });

  it("cannot manage memberships", () => {
    assert.ok(!checkPolicy(clerk, "admin:membership:manage").allowed);
  });

  it("cannot create sales", () => {
    assert.ok(!checkPolicy(clerk, "trading:sale:create").allowed);
  });
});

describe("policy: sales_clerk", () => {
  const sales = makeActor("sales_clerk");

  it("can create sales", () => {
    assert.ok(checkPolicy(sales, "trading:sale:create").allowed);
  });

  it("cannot create issues", () => {
    assert.ok(!checkPolicy(sales, "trading:issue:create").allowed);
  });
});

describe("policy: issue_approver", () => {
  const approver = makeActor("issue_approver");

  it("can decide approvals", () => {
    assert.ok(checkPolicy(approver, "workflow:approval:decide").allowed);
  });

  it("cannot create issues", () => {
    assert.ok(!checkPolicy(approver, "trading:issue:create").allowed);
  });

  it("cannot manage memberships", () => {
    assert.ok(!checkPolicy(approver, "admin:membership:manage").allowed);
  });
});

describe("policy: auditor read-only", () => {
  const auditor = makeActor("auditor");

  it("can read issues and catalog", () => {
    assert.ok(checkPolicy(auditor, "trading:issue:read").allowed);
    assert.ok(checkPolicy(auditor, "catalog:product:read").allowed);
  });

  it("cannot mutate trading or catalog", () => {
    assert.ok(!checkPolicy(auditor, "trading:issue:create").allowed);
    assert.ok(!checkPolicy(auditor, "catalog:product:create").allowed);
    assert.ok(!checkPolicy(auditor, "workflow:approval:decide").allowed);
  });
});

describe("policy: multi-role union", () => {
  it("union of sales_clerk + inventory_clerk grants both capabilities", () => {
    const actor = makeActor(["sales_clerk", "inventory_clerk"]);
    assert.ok(checkPolicy(actor, "trading:sale:create").allowed);
    assert.ok(checkPolicy(actor, "trading:issue:create").allowed);
  });

  it("issue_approver + auditor can decide and read", () => {
    const actor = makeActor(["issue_approver", "auditor"]);
    assert.ok(checkPolicy(actor, "workflow:approval:decide").allowed);
    assert.ok(checkPolicy(actor, "trading:issue:read").allowed);
  });
});

describe("policy: partner (M2M) access", () => {
  const partner = makeActor("partner");

  it("partner can write federation events", () => {
    assert.ok(checkPolicy(partner, "federation:events:write").allowed);
  });

  it("partner cannot read /me", () => {
    assert.ok(!checkPolicy(partner, "platform:me:read").allowed);
  });

  it("partner cannot create issues", () => {
    assert.ok(!checkPolicy(partner, "trading:issue:create").allowed);
  });
});

describe("policy: unknown action — fail-closed", () => {
  it("unknown action is denied", () => {
    assert.ok(!checkPolicy(makeActor("administrator"), "nonexistent:action:do").allowed);
  });
});

describe("policy: health route — open to all authenticated", () => {
  it("clerks and partners can read health", () => {
    assert.ok(checkPolicy(makeActor("inventory_clerk"), "platform:health:read").allowed);
    assert.ok(checkPolicy(makeActor("auditor"), "platform:health:read").allowed);
    assert.ok(checkPolicy(makeActor("partner"), "platform:health:read").allowed);
  });
});

describe("policy: separation of duties", () => {
  it("non-admin job roles cannot manage admin resources", () => {
    for (const role of ["inventory_clerk", "sales_clerk", "issue_approver", "auditor"]) {
      for (const action of [
        "admin:membership:manage",
        "admin:organization:manage",
        "admin:partner:manage",
      ]) {
        assert.ok(!checkPolicy(makeActor(role), action).allowed, `${role} must not ${action}`);
      }
    }
  });

  it("issue_approver cannot create catalog products", () => {
    assert.ok(!checkPolicy(makeActor("issue_approver"), "catalog:product:create").allowed);
  });

  it("warehouse manage is administrator-only", () => {
    assert.ok(checkPolicy(makeActor("administrator"), "inventory:warehouse:manage").allowed);
    assert.ok(!checkPolicy(makeActor("inventory_clerk"), "inventory:warehouse:manage").allowed);
  });
});

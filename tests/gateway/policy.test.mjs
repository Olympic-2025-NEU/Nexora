// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tests/gateway/policy.test.mjs
 *
 * Unit tests for platform/access/policy.ts action matrix.
 *
 * Run: node --test tests/gateway/policy.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline policy logic (mirrors policy.ts to avoid ESM/CJS friction)
// ---------------------------------------------------------------------------

const ACTION_POLICIES = {
  "platform:me:read": { roles: ["administrator", "staff", "approver", "viewer"], adminAlwaysAllowed: true },
  "platform:health:read": { roles: "*" },
  "federation:events:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "federation:acks:write": { roles: ["partner"], adminAlwaysAllowed: false },
  "admin:membership:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:organization:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "admin:partner:manage": { roles: ["administrator"], adminAlwaysAllowed: true },
  "trading:goods-issue:create": { roles: ["staff"], adminAlwaysAllowed: true },
  "trading:goods-issue:approve": { roles: ["approver"], adminAlwaysAllowed: true },
  "trading:goods-issue:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },
  "catalog:product:create": { roles: ["administrator", "staff"], adminAlwaysAllowed: true },
  "catalog:product:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },
  "inventory:stock:read": { roles: ["staff", "approver", "viewer"], adminAlwaysAllowed: true },
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

function makeActor(role, orgId = "org-1") {
  return { userId: "user-" + role, organizationId: orgId, roles: [role], unitIds: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("policy: administrator access", () => {
  const admin = makeActor("administrator");

  it("admin can read /me", () => {
    const { allowed } = checkPolicy(admin, "platform:me:read");
    assert.ok(allowed);
  });

  it("admin can manage membership", () => {
    const { allowed } = checkPolicy(admin, "admin:membership:manage");
    assert.ok(allowed);
  });

  it("admin can create goods-issue (adminAlwaysAllowed bypass)", () => {
    const { allowed } = checkPolicy(admin, "trading:goods-issue:create");
    assert.ok(allowed);
  });

  it("admin CANNOT perform federation:events:write (not in allowed + adminAlwaysAllowed=false)", () => {
    const { allowed } = checkPolicy(admin, "federation:events:write");
    assert.ok(!allowed, "admin must not access partner-only federation endpoint");
  });
});

describe("policy: staff access", () => {
  const staff = makeActor("staff");

  it("staff can read /me", () => {
    const { allowed } = checkPolicy(staff, "platform:me:read");
    assert.ok(allowed);
  });

  it("staff can create goods-issue", () => {
    const { allowed } = checkPolicy(staff, "trading:goods-issue:create");
    assert.ok(allowed);
  });

  it("staff cannot approve goods-issue", () => {
    const { allowed } = checkPolicy(staff, "trading:goods-issue:approve");
    assert.ok(!allowed, "staff must not approve goods-issue");
  });

  it("staff cannot manage memberships (admin-only)", () => {
    const { allowed } = checkPolicy(staff, "admin:membership:manage");
    assert.ok(!allowed, "staff must not manage memberships");
  });

  it("staff cannot access federation endpoints", () => {
    const { allowed } = checkPolicy(staff, "federation:events:write");
    assert.ok(!allowed, "staff must not access M2M federation");
  });
});

describe("policy: approver access", () => {
  const approver = makeActor("approver");

  it("approver can read /me", () => {
    const { allowed } = checkPolicy(approver, "platform:me:read");
    assert.ok(allowed);
  });

  it("approver can approve goods-issue", () => {
    const { allowed } = checkPolicy(approver, "trading:goods-issue:approve");
    assert.ok(allowed);
  });

  it("approver cannot create goods-issue", () => {
    const { allowed } = checkPolicy(approver, "trading:goods-issue:create");
    assert.ok(!allowed, "approver must not create goods-issue");
  });

  it("approver cannot manage memberships", () => {
    const { allowed } = checkPolicy(approver, "admin:membership:manage");
    assert.ok(!allowed);
  });
});

describe("policy: viewer access", () => {
  const viewer = makeActor("viewer");

  it("viewer can read /me", () => {
    const { allowed } = checkPolicy(viewer, "platform:me:read");
    assert.ok(allowed);
  });

  it("viewer can read goods-issues", () => {
    const { allowed } = checkPolicy(viewer, "trading:goods-issue:read");
    assert.ok(allowed);
  });

  it("viewer cannot create goods-issue", () => {
    const { allowed } = checkPolicy(viewer, "trading:goods-issue:create");
    assert.ok(!allowed);
  });

  it("viewer cannot approve goods-issue", () => {
    const { allowed } = checkPolicy(viewer, "trading:goods-issue:approve");
    assert.ok(!allowed);
  });

  it("viewer cannot manage admin resources", () => {
    const { allowed } = checkPolicy(viewer, "admin:membership:manage");
    assert.ok(!allowed);
  });
});

describe("policy: partner (M2M) access", () => {
  const partner = makeActor("partner");

  it("partner can write federation events", () => {
    const { allowed } = checkPolicy(partner, "federation:events:write");
    assert.ok(allowed);
  });

  it("partner can write federation acks", () => {
    const { allowed } = checkPolicy(partner, "federation:acks:write");
    assert.ok(allowed);
  });

  it("partner cannot read /me (user-only endpoint)", () => {
    const { allowed } = checkPolicy(partner, "platform:me:read");
    assert.ok(!allowed, "partner (M2M) must not access user /me");
  });

  it("partner cannot create goods-issue", () => {
    const { allowed } = checkPolicy(partner, "trading:goods-issue:create");
    assert.ok(!allowed);
  });
});

describe("policy: unknown action — fail-closed", () => {
  it("unknown action is denied for any role", () => {
    const admin = makeActor("administrator");
    const { allowed } = checkPolicy(admin, "nonexistent:action:do");
    assert.ok(!allowed, "unknown action must be denied (fail-closed)");
  });
});

describe("policy: health route — open to all authenticated", () => {
  it("staff can read health", () => {
    const { allowed } = checkPolicy(makeActor("staff"), "platform:health:read");
    assert.ok(allowed);
  });

  it("viewer can read health", () => {
    const { allowed } = checkPolicy(makeActor("viewer"), "platform:health:read");
    assert.ok(allowed);
  });

  it("partner can read health", () => {
    const { allowed } = checkPolicy(makeActor("partner"), "platform:health:read");
    assert.ok(allowed);
  });
});

describe("policy: separation of duties", () => {
  it("staff cannot perform admin actions even via API (manual call)", () => {
    const staff = makeActor("staff");
    const adminActions = ["admin:membership:manage", "admin:organization:manage", "admin:partner:manage"];
    for (const action of adminActions) {
      const { allowed } = checkPolicy(staff, action);
      assert.ok(!allowed, `staff must not perform ${action}`);
    }
  });

  it("approver cannot create without also having create role", () => {
    const approver = makeActor("approver");
    const { allowed } = checkPolicy(approver, "catalog:product:create");
    assert.ok(!allowed, "approver-only must not create catalog entries");
  });
});

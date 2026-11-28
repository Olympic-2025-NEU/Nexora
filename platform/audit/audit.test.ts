// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import type { Actor } from "../identity/actor";
import { TokenError } from "../identity/token";
import { handleAuditGet } from "./http-handler";
import { parseAuditFilters } from "./audit-query";
import { prismaAuditRecorder, sanitizeAuditSummary } from "./prisma-audit-recorder";
import { auditAuthenticationFailure, auditDeny, auditFailure } from "./security-audit";

const administrator: Actor = {
  userId: "admin-sub", organizationId: randomUUID(), unitIds: [], roles: ["administrator"],
};
const staff: Actor = { ...administrator, userId: "staff-sub", roles: ["inventory_clerk"] };

describe("audit data boundary", () => {
  it("copies only fixed, bounded summary fields", () => {
    const summary = sanitizeAuditSummary({
      status: "confirmed", version: 2, changedFields: ["status", "password", "status"],
      tool: "getLot", email: "private@example.test", token: "sensitive-token",
      note: { secret: "sensitive-token" },
    });
    assert.deepEqual(summary, {
      status: "confirmed", version: 2, changedFields: ["status"], tool: "getLot",
    });
    assert.deepEqual(sanitizeAuditSummary({ status: "sensitive-token", version: -1 }), {});
  });

  it("keeps warehouse scope ids and quality reason when bounded", () => {
    const wid = randomUUID();
    const summary = sanitizeAuditSummary({
      warehouseIds: [wid, "not-a-uuid", wid],
      changedFields: ["warehouseIds", "role", "secret"],
      reason: "Mark available after QC",
      role: "inventory_clerk",
    });
    assert.deepEqual(summary.warehouseIds, [wid]);
    assert.equal(summary.warehouseCount, 1);
    assert.deepEqual(summary.changedFields, ["warehouseIds", "role"]);
    assert.equal(summary.reason, "Mark available after QC");
    assert.equal(summary.role, "inventory_clerk");
  });

  it("records actor, target, request and redacted summary on the caller's transaction client", async () => {
    let captured: Record<string, unknown> | undefined;
    const tx = { auditLog: { create({ data }: { data: Record<string, unknown> }) {
      captured = data;
      return Promise.resolve(data);
    } } } as unknown as Prisma.TransactionClient;
    const id = await prismaAuditRecorder.record(tx, {
      actor: { kind: "service", clientId: "core-data" },
      action: "core.record.create", targetType: "core_record", targetId: randomUUID(),
      requestId: randomUUID(), correlationId: randomUUID(),
      after: { kind: "evidence_metadata", password: "sensitive-token" },
    });
    assert.equal(captured?.id, id);
    assert.equal(captured?.clientId, "core-data");
    assert.equal(captured?.actorSub, null);
    assert.equal(captured?.outcome, "success");
    assert.deepEqual(captured?.afterSummary, { kind: "evidence_metadata" });
    assert.ok(!JSON.stringify(captured).includes("sensitive-token"));
    await assert.rejects(prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: "admin-sub" }, action: "record.update",
      targetType: "core_record", targetId: randomUUID(), requestId: "x".repeat(129),
    }), /Invalid audit requestId/);
    await assert.rejects(prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: "admin-sub" }, action: "record.update",
      targetType: "core_record", targetId: randomUUID(), requestId: "jwt.part.signature",
    }), /Invalid audit requestId/);
  });

  it("deny/failure security log discards arbitrary detail and untrusted request IDs", () => {
    const messages: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => { messages.push(message); };
    try {
      auditDeny(administrator, "platform:audit:read", "jwt.part.secret", "private@example.test");
      auditFailure(administrator, "platform:audit:read", randomUUID(), "DB_UNAVAILABLE");
      auditAuthenticationFailure("platform:audit:read", "jwt.part.secret", "TOKEN_MISSING");
    } finally {
      console.warn = original;
    }
    assert.equal(messages.length, 3);
    assert.ok(messages[0].includes("REDACTED_DETAIL"));
    assert.ok(messages[1].includes("DB_UNAVAILABLE"));
    assert.ok(messages[2].includes('"type":"unauthenticated"'));
    assert.ok(!messages.join(" ").includes("private@example.test"));
    assert.ok(!messages.join(" ").includes("jwt.part.secret"));
    assert.ok(!messages.join(" ").includes(administrator.userId));
  });
});

describe("administrator audit HTTP query", () => {
  const request = (query = "") => new NextRequest(`http://localhost/api/v1/audit-logs${query}`);
  const repository = { async list(filters: ReturnType<typeof parseAuditFilters>) {
    assert.equal(filters.targetType, "document");
    assert.equal(filters.requestId, "request-123");
    return { data: [], page: { limit: filters.limit } };
  } };

  it("accepts allowlisted target/request filters for Administrator", async () => {
    const result = await handleAuditGet(request("?targetType=document&requestId=request-123"), {
      resolveActor: async () => administrator, repository,
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    assert.deepEqual(body.data, []);
    assert.equal(body.page.limit, 20);
    assert.ok(body.requestId);
  });

  it("rejects missing auth, non-admin role and arbitrary filters", async () => {
    const original = console.warn;
    const messages: string[] = [];
    console.warn = (message: string) => { messages.push(message); };
    try {
      const unauthenticated = await handleAuditGet(request(), {
        resolveActor: async () => { throw new TokenError("TOKEN_MISSING", "missing"); }, repository,
      });
      assert.equal(unauthenticated.status, 401);
      const denied = await handleAuditGet(request("?sort=raw_sql"), {
        resolveActor: async () => staff, repository,
      });
      assert.equal(denied.status, 403);
    } finally {
      console.warn = original;
    }
    assert.ok(messages.some((message) => message.includes('"type":"unauthenticated"')));
    assert.ok(messages.some((message) => message.includes("POLICY_DENIED")));
    const invalid = await handleAuditGet(request("?sort=raw_sql"), {
      resolveActor: async () => administrator, repository,
    });
    assert.equal(invalid.status, 400);
  });

  it("rejects duplicate, out-of-range and normalized date filters", () => {
    for (const query of [
      "limit=101", "limit=0", "action=a&action=b", "cursor=jwt.part.secret",
      "from=2026-02-31T00:00:00Z", "from=2026-01-01T25:00:00Z",
      "from=2026-01-01", "from=2026-11-20T00:00:00Z&to=2026-11-19T00:00:00Z",
    ]) {
      assert.throws(() => parseAuditFilters(new URLSearchParams(query)), { code: "INVALID_AUDIT_QUERY" });
    }
    assert.equal(parseAuditFilters(new URLSearchParams("from=2026-02-28T23:30:00%2B01:00")).from?.toISOString(),
      "2026-02-28T22:30:00.000Z");
  });
});

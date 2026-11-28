// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type { Actor } from "../../platform/identity/actor";
import { getPrismaClient } from "../../platform/persistence/prisma";
import { toolAudit } from "../../contexts/ai/infrastructure/tool-audit";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.DATABASE_URL?.includes("app_runtime:test_app@127.0.0.1")) {
  throw new Error("AI tool audit integration requires an isolated app_runtime test database");
}
const db = getPrismaClient();
after(async () => db.$disconnect());

function actor(): Actor {
  return { userId: randomUUID(), organizationId: randomUUID(), unitIds: [], roles: ["inventory_clerk"] };
}

test("concurrent draft reservations enforce five per minute and persist denials", async () => {
  const user = actor();
  const decisions = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    toolAudit.reserve(user, i % 2 ? "createIssueDraft" : "createReceiptDraft", randomUUID())));
  assert.equal(decisions.filter(Boolean).length, 5);
  const entries = await db.auditLog.findMany({ where: { actorSub: user.userId }, orderBy: { createdAt: "asc" } });
  assert.equal(entries.filter((entry) => entry.action === "ai.tool.reserve").length, 5);
  assert.equal(entries.filter((entry) => entry.outcome === "deny").length, 3);
  assert.ok(entries.every((entry) => !JSON.stringify(entry).includes("Bearer")));
});

test("completed call has outcome and UUID source IDs without raw token", async () => {
  const user = actor();
  const requestId = randomUUID();
  const source = randomUUID();
  assert.equal(await toolAudit.reserve(user, "getTrace", requestId), true);
  await toolAudit.complete(user, "getTrace", requestId, "success", [source, "Bearer private-token"]);
  const entry = await db.auditLog.findFirstOrThrow({ where: {
    actorSub: user.userId, action: "ai.tool.getTrace", requestId,
  } });
  assert.equal(entry.outcome, "success");
  assert.deepEqual(entry.afterSummary, { tool: "getTrace", sourceIds: [source] });
  assert.ok(!JSON.stringify(entry).includes("private-token"));
});

test("read quota is thirty reservations per minute per actor", async () => {
  const user = actor();
  for (let i = 0; i < 30; i++) {
    assert.equal(await toolAudit.reserve(user, "getLot", randomUUID()), true);
  }
  assert.equal(await toolAudit.reserve(user, "getLot", randomUUID()), false);
  assert.equal(await db.auditLog.count({ where: { actorSub: user.userId, action: "ai.tool.reserve" } }), 30);
});

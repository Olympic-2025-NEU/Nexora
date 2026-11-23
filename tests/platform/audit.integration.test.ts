// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prismaAuditRecorder } from "../../platform/audit/prisma-audit-recorder";
import { prismaAuditQueryRepository } from "../../platform/audit/prisma-audit-query";
import { createTransaction } from "../../platform/persistence/transaction";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.DATABASE_URL ||
    !process.env.CORE_DATABASE_URL || !process.env.APP_DATABASE_URL) {
  throw new Error("Audit integration tests require an isolated migrated test database");
}
const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });
const admin = connect(process.env.DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
const work = createTransaction(core);
after(async () => Promise.all([admin.$disconnect(), core.$disconnect(), app.$disconnect()]));

function recordData(id: string) {
  const payload = { schemaVersion: "1.0", reference: id };
  return {
    id, kind: "evidence_metadata", sourceType: "document", sourceId: id,
    payload, visibility: "private", policyVersion: "v1",
    checksumHex: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    builtAt: new Date(),
  };
}

test("record and success audit commit together; secrets never reach JSONB", async () => {
  const id = randomUUID();
  const requestId = randomUUID();
  let auditId = "";
  await work.run(async (tx) => {
    await tx.coreRecord.create({ data: recordData(id) });
    auditId = await prismaAuditRecorder.record(tx, {
      actor: { kind: "service", clientId: "core-data" },
      action: "core.record.create", targetType: "core_record", targetId: id,
      requestId, correlationId: randomUUID(),
      before: { password: "secret-sentinel" },
      after: { kind: "evidence_metadata", status: "active", token: "secret-sentinel" },
    });
  });
  assert.ok(await core.coreRecord.findUnique({ where: { id } }));
  const audit = await app.auditLog.findUniqueOrThrow({ where: { id: auditId } });
  assert.equal(audit.clientId, "core-data");
  assert.equal(audit.actorSub, null);
  assert.equal(audit.action, "core.record.create");
  assert.equal(audit.requestId, requestId);
  assert.deepEqual(audit.afterSummary, { kind: "evidence_metadata", status: "active" });
  assert.ok(!JSON.stringify(audit).includes("secret-sentinel"));
  await assert.rejects(core.auditLog.update({ where: { id: auditId }, data: { action: "tamper" } }));
  await assert.rejects(core.auditLog.delete({ where: { id: auditId } }));
  await assert.rejects(app.auditLog.update({ where: { id: auditId }, data: { action: "tamper" } }));
});

test("failure after audit rolls back both record and audit", async () => {
  const id = randomUUID();
  await assert.rejects(work.run(async (tx) => {
    await tx.coreRecord.create({ data: recordData(id) });
    await prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: "verified-user" },
      action: "core.record.create", targetType: "core_record", targetId: id,
      requestId: randomUUID(), after: { kind: "evidence_metadata" },
    });
    throw new Error("injected after audit");
  }), /injected after audit/);
  assert.equal(await core.coreRecord.findUnique({ where: { id } }), null);
  assert.equal(await app.auditLog.count({ where: { targetType: "core_record", targetId: id } }), 0);
});

test("Administrator repository filters by target/request and pages without exposing summary", async () => {
  const targetId = `message:${randomUUID()}`;
  const requests = [randomUUID(), randomUUID(), randomUUID()];
  for (const requestId of requests) {
    await work.run((tx) => prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: "verified-user" },
      action: "partner.connection.verify", targetType: "message", targetId,
      requestId, correlationId: randomUUID(),
      after: { status: "active", apiKey: "secret-sentinel" },
    }));
  }
  const query = prismaAuditQueryRepository(app);
  const byRequest = await query.list({ limit: 20, requestId: requests[1], targetType: "message" });
  assert.equal(byRequest.data.length, 1);
  assert.equal(byRequest.data[0].requestId, requests[1]);
  assert.ok(!("afterSummary" in byRequest.data[0]));
  const page1 = await query.list({ limit: 1, targetType: "message", targetId });
  assert.equal(page1.data.length, 1);
  assert.ok(page1.page.nextCursor);
  const page2 = await query.list({ limit: 1, targetType: "message", targetId, cursor: page1.page.nextCursor });
  assert.equal(page2.data.length, 1);
  assert.notEqual(page1.data[0].id, page2.data[0].id);
  const page3 = await query.list({ limit: 1, targetType: "message", targetId, cursor: page2.page.nextCursor });
  assert.equal(page3.data.length, 1);
  assert.equal(page3.page.nextCursor, undefined);
  assert.deepEqual(new Set([...page1.data, ...page2.data, ...page3.data].map((row) => row.id)).size, 3);
  const allRows = await admin.auditLog.findMany({ where: { targetType: "message", targetId } });
  assert.ok(allRows.every((row) => !JSON.stringify(row.afterSummary).includes("secret-sentinel")));
});

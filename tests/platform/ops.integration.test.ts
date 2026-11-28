// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import type { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { GET as metricsGet } from "../../app/api/v1/metrics/route";
import { createRetryHandlers } from "../../platform/operations/http-handler";
import { createFederationOperationsHandlers } from "../../platform/operations/federation-http";
import { scanStuckWork } from "../../platform/observability/alerts";
import { TokenError } from "../../platform/identity/token";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.APP_DATABASE_URL || !process.env.MIGRATOR_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.APP_DATABASE_URL) throw Error("Isolated DB required");
const db = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
const migrator = new PrismaClient({ datasources: { db: { url: process.env.MIGRATOR_DATABASE_URL } } });
after(async () => { await Promise.all([db.$disconnect(), migrator.$disconnect()]); });
const sentinel = "ops-secret-sentinel-DO-NOT-LEAK";
const request = (sub: string, method = "GET", body?: object) => new Request("http://localhost/api/v1/admin/retries", {
  method, headers: { "x-fixture-sub": sub, "x-request-id": randomUUID(), ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}) as NextRequest;

test("metrics, scan, permissioned list/retry and non-leakage", async () => {
  const orgId = randomUUID(), messageId = randomUUID(), correlationId = randomUUID();
  const stuckId = randomUUID(), haltedId = randomUUID();
  const old = new Date(Date.now() - 20 * 60_000);
  await migrator.organization.create({ data: { id: orgId, instanceId: `ops-${orgId}`, code: `ops-${orgId}`, name: "Ops" } });
  for (const [sub, role] of [["ops-admin", "administrator"], ["ops-staff", "inventory_clerk"]]) {
    await migrator.membership.create({ data: { id: randomUUID(), organizationId: orgId, keycloakSub: sub,
      displayName: sub, role, status: "active" } });
  }
  await db.$executeRaw`INSERT INTO platform.outbox_message
    (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version, destination,
     correlation_id, payload, last_error_code, status, created_at)
    VALUES (${messageId}::uuid, 'approval_request', ${randomUUID()}::uuid, 1,
      'workflow.approval.requested.v1', '1', 'workflow', ${correlationId}, ${JSON.stringify({ secret: sentinel })}::jsonb,
      ${sentinel}, 'dead_letter', ${old})`;
  await db.$executeRaw`INSERT INTO platform.outbox_message
    (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version, destination,
     correlation_id, payload, status, created_at)
    VALUES (${randomUUID()}::uuid, 'approval_request', ${randomUUID()}::uuid, 1,
      'workflow.approval.requested.v1', '1', 'workflow', ${randomUUID()}, '{}'::jsonb, 'pending', ${old})`;
  for (const [id, state] of [[stuckId, "decision_pending"], [haltedId, "halted"]] as const) {
    const documentId = randomUUID();
    await migrator.document.create({ data: { id: documentId, documentType: "goods_issue",
      issuePurpose: "other", documentNumber: randomUUID(), status: "draft",
      createdBySub: "ops-creator", correlationId: randomUUID() } });
    await db.$executeRaw`INSERT INTO platform.approval_request
      (id, document_id, creator_sub, submitted_document_version, warehouse_ids, line_snapshot_sha256,
       state, created_at, halt_reason, flowable_process_id, decision_requested_at)
      VALUES (${id}::uuid, ${documentId}::uuid, 'ops-creator', 1, '[]'::jsonb, ${"a".repeat(64)},
        ${state}::platform.approval_request_state, ${old},
        ${state === "halted" ? "DUPLICATE_PROCESS" : null},
        ${state === "decision_pending" ? "ops-process-1" : null},
        ${state === "decision_pending" ? old : null})`;
  }
  const handlers = createRetryHandlers(() => ({ db, async resolveActor(req) {
    const sub = req.headers.get("x-fixture-sub");
    if (!sub) throw new TokenError("TOKEN_MISSING", "missing");
    const member = await db.membership.findUnique({ where: { keycloakSub: sub } });
    if (!member || member.status !== "active") throw new TokenError("TOKEN_MISSING", "missing");
    return { userId: member.keycloakSub, organizationId: member.organizationId, roles: [member.role], unitIds: [] };
  } }));

  const metricsResponse = await metricsGet(new Request("http://localhost/api/v1/metrics"));
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.text();
  assert.match(metrics, /outbox_dead\{destination="workflow"\} 1/);
  assert.match(metrics, /workflow_pending\{state="decision_pending"\} 1/);
  assert.match(metrics, /workflow_failed\{halt_reason="DUPLICATE_PROCESS"\} 1/);
  for (const name of ["outbox_oldest_pending_age_seconds", "workflow_oldest_pending_age_seconds"]) {
    assert.ok(Number(metrics.match(new RegExp(`${name} ([0-9.]+)`))?.[1]) > 0);
  }
  const lines: object[] = [];
  const alerts = await scanStuckWork(db, (line) => lines.push(line));
  assert.ok(alerts.some((alert) => alert.kind === "outbox_dead" && alert.messageId === messageId));
  assert.ok(alerts.some((alert) => alert.kind === "workflow_decision_stuck" &&
    alert.approvalRequestId === stuckId && alert.processId === "ops-process-1"));
  assert.ok(lines.some((line) => "event" in line && line.event === "ops.scan.completed"));

  const adminGet = await handlers.GET(request("ops-admin"));
  assert.equal(adminGet.status, 200);
  const listing = await adminGet.text();
  assert.ok(listing.includes(messageId) && listing.includes(haltedId));
  assert.ok(!listing.includes('"payload"'));
  assert.equal((await handlers.GET(request("ops-staff"))).status, 403);
  assert.equal((await handlers.GET(request(""))).status, 401);
  assert.equal((await handlers.POST(request("ops-staff", "POST", { messageId }))).status, 403);
  assert.equal((await db.outboxMessage.findUniqueOrThrow({ where: { id: messageId } })).status, "dead_letter");
  assert.equal(await db.auditLog.count({ where: { targetId: messageId } }), 0);
  assert.equal((await handlers.POST(request("ops-admin", "POST", { messageId, payload: "changed" }))).status, 400);
  assert.equal((await handlers.POST(request("ops-admin", "POST", { messageId: randomUUID() }))).status, 404);
  assert.equal((await db.outboxMessage.findUniqueOrThrow({ where: { id: messageId } })).status, "dead_letter");

  const retried = await handlers.POST(request("ops-admin", "POST", { messageId }));
  assert.equal(retried.status, 202);
  const result = await retried.json();
  assert.equal(result.status, "pending");
  assert.equal((await db.outboxMessage.findUniqueOrThrow({ where: { id: messageId } })).status, "pending");
  const records = await db.auditLog.findMany({ where: { targetId: messageId } });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, result.auditId);
  assert.equal(records[0].actorSub, "ops-admin");
  assert.equal(records[0].action, "outbox.dead_letter.retried");
  assert.equal(records[0].correlationId, correlationId);
  assert.equal((await handlers.POST(request("ops-admin", "POST", { messageId }))).status, 409);
  assert.equal((await db.auditLog.count({ where: { targetId: messageId } })), 1);
  assert.equal((await handlers.POST(request("ops-staff", "POST", { messageId }))).status, 403);
  assert.equal((await db.auditLog.count({ where: { targetId: messageId } })), 1);
  assert.ok(![metrics, listing, JSON.stringify(lines), JSON.stringify(records)].some((output) => output.includes(sentinel)));
  console.log(JSON.stringify({ event: "ops.fixture.sample", metrics: metrics.trim().split("\n"), alert: alerts[0] }));
});

test("federation operator can trace message, retry pending mapping with audit, and cannot reveal payload", async () => {
  const partnerId = randomUUID(), outboxId = randomUUID(), queuedId = randomUUID(), messageId = randomUUID();
  const inboxId = randomUUID(), old = new Date(Date.now() - 20 * 60_000);
  await migrator.partner.create({ data: { id: partnerId, issuerInstanceId: `ops-${partnerId}`,
    code: `ops-${partnerId}`, displayName: "Remote", createdBySub: "fixture" } });
  const envelope = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
  envelope.messageId = messageId;
  envelope.eventId = randomUUID();
  await migrator.inboxMessage.create({ data: { id: inboxId, issuerInstanceId: envelope.issuerInstanceId,
    messageId, eventId: envelope.eventId, eventType: envelope.eventType,
    schemaVersion: envelope.schemaVersion, payloadSha256: "a".repeat(64), payload: envelope,
    partnerId, state: "pending_dependency", errorCode: "UNKNOWN_LOT_MAPPING", receivedAt: old } });
  await db.$executeRaw`INSERT INTO platform.outbox_message
    (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version, destination,
     correlation_id, payload, last_error_code, status, created_at)
    VALUES (${outboxId}::uuid, 'document', ${randomUUID()}::uuid, 1,
      'transfer.announced.v1', '1.0', 'federation', ${randomUUID()},
      ${JSON.stringify({ messageId, private: sentinel })}::jsonb, ${sentinel}, 'dead_letter', ${old})`;
  await db.$executeRaw`INSERT INTO platform.outbox_message
    (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version, destination,
     correlation_id, payload, status, created_at, next_attempt_at)
    VALUES (${queuedId}::uuid, 'document', ${randomUUID()}::uuid, 1,
      'receipt.confirmed.v1', '1.0', 'federation', ${randomUUID()}, '{}'::jsonb,
      'retry_due', ${old}, ${old})`;
  await migrator.deliveryAttempt.create({ data: { id: randomUUID(), outboxId, attemptNo: 1,
    endpointHost: "partner.invalid", result: "permanent_failure", errorCode: sentinel } });
  const handler = createFederationOperationsHandlers(() => ({ db, async resolveActor(req) {
    const sub = req.headers.get("x-fixture-sub");
    if (!sub) throw new TokenError("TOKEN_MISSING", "missing");
    const member = await db.membership.findUnique({ where: { keycloakSub: sub } });
    if (!member || member.status !== "active") throw new TokenError("TOKEN_MISSING", "missing");
    return { userId: sub, organizationId: member.organizationId, roles: [member.role], unitIds: [] };
  } }));
  const get = (sub: string, id: string = messageId) => new Request(
    `http://localhost/api/v1/admin/federation/operations?messageId=${id}`,
    { headers: { "x-fixture-sub": sub, "x-request-id": randomUUID() } }) as NextRequest;
  const post = (sub: string, body: object) => new Request(
    "http://localhost/api/v1/admin/federation/operations", { method: "POST",
      headers: { "x-fixture-sub": sub, "content-type": "application/json" },
      body: JSON.stringify(body) }) as NextRequest;
  assert.equal((await handler.GET(get("ops-staff"))).status, 403);
  assert.equal((await handler.GET(get(""))).status, 401);
  assert.equal((await handler.GET(get("ops-admin", "bad-id"))).status, 400);
  const response = await handler.GET(get("ops-admin"));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes(messageId) && text.includes(outboxId) && text.includes(inboxId));
  assert.ok(text.includes("UNKNOWN_LOT_MAPPING"));
  assert.ok(!text.includes(sentinel) && !text.includes("partner.invalid") && !text.includes('"payload"'));
  assert.equal((await handler.POST(post("ops-staff", { action: "reprocess", inboxId }))).status, 403);
  assert.equal((await handler.POST(post("ops-admin", { action: "reprocess", inboxId, payload: sentinel }))).status, 400);
  assert.equal((await handler.POST(post("ops-admin", { action: "reprocess", inboxId: randomUUID() }))).status, 404);
  const reprocessed = await handler.POST(post("ops-admin", { action: "reprocess", inboxId }));
  assert.equal(reprocessed.status, 202);
  assert.equal((await reprocessed.json()).state, "pending_dependency");
  const audit = await db.auditLog.findMany({ where: { targetId: inboxId } });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "federation.inbox.reprocessed");
  const invalidId = randomUUID(), invalidMessageId = randomUUID();
  const invalidEnvelope = { ...envelope, messageId: invalidMessageId, eventId: randomUUID(),
    lots: envelope.lots.map((lot: { senderBatch: object }) => ({ ...lot,
      senderBatch: { ...lot.senderBatch, instanceId: "wrong-issuer" } })) };
  await migrator.inboxMessage.create({ data: { id: invalidId,
    issuerInstanceId: envelope.issuerInstanceId, messageId: invalidMessageId,
    eventId: invalidEnvelope.eventId, eventType: envelope.eventType,
    schemaVersion: envelope.schemaVersion, payloadSha256: "b".repeat(64),
    payload: invalidEnvelope, partnerId, state: "pending_dependency", receivedAt: old } });
  const rejected = await handler.POST(post("ops-admin", { action: "reprocess", inboxId: invalidId }));
  assert.equal(rejected.status, 202);
  assert.equal((await rejected.json()).state, "rejected");
  assert.equal((await db.inboxMessage.findUniqueOrThrow({ where: { id: invalidId } })).state, "rejected");
  assert.equal(await db.auditLog.count({ where: { targetId: invalidId } }), 1);
  const metrics = await (await metricsGet(new Request("http://localhost/api/v1/metrics"))).text();
  assert.match(metrics, /federation_inbox\{state="pending_dependency"\} 1/);
  assert.match(metrics, /federation_delivery_attempts\{result="permanent_failure"\} 1/);
  assert.match(metrics, /federation_queue_due 1/);
  const alerts = await scanStuckWork(db, () => undefined);
  assert.ok(alerts.some((alert) => alert.kind === "federation_inbox_pending" && alert.messageId === messageId));
  assert.ok(alerts.some((alert) => alert.kind === "federation_queue_stuck" && alert.messageId === queuedId));
  assert.ok(!JSON.stringify(audit).includes(sentinel));
});

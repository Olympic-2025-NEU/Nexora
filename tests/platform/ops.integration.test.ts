// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { GET as metricsGet } from "../../app/api/v1/metrics/route";
import { createRetryHandlers } from "../../platform/operations/http-handler";
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
  for (const [sub, role] of [["ops-admin", "administrator"], ["ops-staff", "staff"]]) {
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
    await db.$executeRaw`INSERT INTO platform.approval_request
      (id, document_id, creator_sub, submitted_document_version, warehouse_ids, line_snapshot_sha256,
       state, created_at, halt_reason, flowable_process_id, decision_requested_at)
      VALUES (${id}::uuid, ${randomUUID()}::uuid, 'ops-creator', 1, '[]'::jsonb, ${"a".repeat(64)},
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

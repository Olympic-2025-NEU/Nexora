// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { computeLineSnapshotSha256 } from "../../contracts/workflow/line-snapshot";
import { createRequest, recordDecisionIntent, confirmApproval, cancelRequest } from "../../platform/workflow/approval-service";
import { createFlowableStarter } from "../../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../../platform/workflow/flowable-decider";
import { reconcileApproval } from "../../platform/workflow/reconciler";
import { FlowableClient } from "../../platform/workflow/flowable-client";
import { SnapshotMismatchError, SelfApprovalError, ApprovalScopeError, ApprovalNotReadyError,
  type ApprovalActor } from "../../platform/workflow/approval-request";
import type { OutboxMessage } from "../../platform/outbox/message";

const databaseUrl = new URL(process.env.APP_DATABASE_URL!);
databaseUrl.hostname = "127.0.0.1";
databaseUrl.port = process.env.POSTGRES_HOST_PORT!;
const db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const engine = new FlowableClient({ baseUrl: `http://127.0.0.1:${process.env.FLOWABLE_HOST_PORT}`,
  user: process.env.FLOWABLE_ADMIN_USER!, password: process.env.FLOWABLE_ADMIN_PASSWORD! });
const warehouseId = randomUUID();
const actor: ApprovalActor = { sub: "fixture-approver", role: "approver", warehouseIds: [warehouseId], active: true };
const resolver = async (sub: string) => sub === actor.sub ? actor : { ...actor, sub };
const lines = [{ lineNo: 1, warehouseId, productId: randomUUID(), batchId: randomUUID(), quantity: 3, unit: "kg" }];
const hash = computeLineSnapshotSha256(lines);
const message = (id: string, payload: object): OutboxMessage => ({ id: randomUUID(), createdAt: new Date(),
  aggregateType: "approval_request", aggregateId: id, aggregateVersion: 1, destination: "workflow",
  correlationId: id, eventType: "workflow.approval.requested.v1", schemaVersion: "1", payload,
  status: "leased", attemptCount: 1, nextAttemptAt: new Date(), leaseOwner: null, leaseUntil: null,
  lastErrorCode: null, deliveredAt: null });

async function fixture() {
  return db.$transaction((tx) => createRequest(tx, { documentId: randomUUID(),
    creatorSub: "fixture-creator", submittedDocumentVersion: 1,
    warehouseIds: [warehouseId], lineSnapshotSha256: hash }));
}

async function start(row: Awaited<ReturnType<typeof fixture>>) {
  const starter = createFlowableStarter(db, engine);
  const event = message(row.id, { approvalRequestId: row.id });
  await starter(event);
  await starter(event);
  const pending = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(pending.state, "pending");
  assert.equal((await engine.findInstances(row.id)).length, 1);
  const tasks = await engine.queryTasks({ processInstanceId: pending.flowableProcessId! });
  assert.equal(tasks.length, 1);
  return { pending, taskId: tasks[0].id };
}

test("bridge approve, replay, reconcile-on-read and atomic confirm", { timeout: 120000 }, async () => {
  const row = await fixture();
  const { pending, taskId } = await start(row);
  await assert.rejects(db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: row.creatorSub, decision: "approved", flowableTaskId: taskId,
    expectedVersion: pending.version,
  })), SelfApprovalError);
  actor.warehouseIds = [];
  await assert.rejects(db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: actor.sub, decision: "approved", flowableTaskId: taskId,
    expectedVersion: pending.version,
  })), ApprovalScopeError);
  actor.warehouseIds = [warehouseId];
  const input = { approvalRequestId: row.id, actorSub: actor.sub, decision: "approved" as const,
    flowableTaskId: taskId, expectedVersion: pending.version };
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, input));
  assert.equal((await db.$transaction((tx) => recordDecisionIntent(tx, resolver, input))).version, intent.version);
  const payload = { approvalRequestId: row.id, taskId, decision: "approved" as const,
    intentVersion: intent.version, requestedAt: intent.decisionRequestedAt!.toISOString(), lineSnapshotSha256: hash };
  await createFlowableDecider(db, engine, resolver)(message(row.id, payload));
  const reconcile = (id: string) => reconcileApproval(db, engine, id);
  lines[0].quantity++;
  await assert.rejects(db.$transaction((tx) => confirmApproval(tx, resolver, reconcile, {
    approvalRequestId: row.id, actorSub: actor.sub, currentLineSnapshotSha256: computeLineSnapshotSha256(lines),
  })), SnapshotMismatchError);
  await assert.rejects(db.$transaction(async (tx) => {
    await confirmApproval(tx, resolver, reconcile, { approvalRequestId: row.id, actorSub: actor.sub,
      currentLineSnapshotSha256: hash });
    throw new Error("forced rollback");
  }));
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state, "approved");
  await db.$transaction((tx) => confirmApproval(tx, resolver, reconcile, { approvalRequestId: row.id,
    actorSub: actor.sub, currentLineSnapshotSha256: hash }));
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state, "confirmed");
});

test("bridge rejects with reason, cancel tombstone and external completion", { timeout: 120000 }, async () => {
  const rejection = await fixture();
  const { pending, taskId } = await start(rejection);
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: rejection.id, actorSub: actor.sub, decision: "rejected", reason: "Damaged lot",
    flowableTaskId: taskId, expectedVersion: pending.version }));
  await createFlowableDecider(db, engine, resolver)(message(rejection.id, { approvalRequestId: rejection.id,
    intentVersion: intent.version, taskId, decision: "rejected", lineSnapshotSha256: hash,
    requestedAt: intent.decisionRequestedAt!.toISOString() }));
  await reconcileApproval(db, engine, rejection.id);
  const rejected = await db.approvalRequest.findUniqueOrThrow({ where: { id: rejection.id } });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.decisionReason, "Damaged lot");
  await assert.rejects(db.$transaction((tx) => confirmApproval(tx, resolver,
    (id) => reconcileApproval(db, engine, id), { approvalRequestId: rejection.id,
      actorSub: actor.sub, currentLineSnapshotSha256: hash })), ApprovalNotReadyError);
  const cancelled = await fixture();
  await start(cancelled);
  await db.$transaction((tx) => cancelRequest(tx, { approvalRequestId: cancelled.id,
    actorSub: "fixture-creator", reason: "withdrawn" }));
  await reconcileApproval(db, engine, cancelled.id);
  assert.ok((await db.approvalRequest.findUniqueOrThrow({ where: { id: cancelled.id } })).engineCleanupAt);
  const external = await fixture();
  const { pending: open, taskId: openTask } = await start(external);
  await engine.completeTask(openTask, { decision: "approved", approverSub: "external", decidedAt: new Date().toISOString() });
  await reconcileApproval(db, engine, external.id);
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: external.id } })).haltReason, "EXTERNAL_COMPLETION");
  assert.ok(open.flowableProcessId);
});

test("seeded lost response matches nonce and never completes a second task", { timeout: 120000 }, async () => {
  const first = await fixture();
  const { pending, taskId } = await start(first);
  const second = await fixture();
  const { taskId: untouched } = await start(second);
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: first.id, actorSub: actor.sub, decision: "approved", flowableTaskId: taskId,
    expectedVersion: pending.version }));
  const payload = { approvalRequestId: first.id, taskId, decision: "approved" as const,
    intentVersion: intent.version, lineSnapshotSha256: hash, requestedAt: intent.decisionRequestedAt!.toISOString() };
  await engine.completeTask(taskId, { decision: "approved", approverSub: actor.sub, decidedAt: payload.requestedAt });
  await createFlowableDecider(db, engine, resolver)(message(first.id, payload));
  await reconcileApproval(db, engine, first.id);
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: first.id } })).state, "approved");
  assert.equal((await engine.getTask(untouched)).id, untouched);
});

test("seeded duplicate process halts and role revocation leaves task open", { timeout: 120000 }, async () => {
  const duplicate = await fixture();
  const { pending } = await start(duplicate);
  await engine.startProcess({ businessKey: duplicate.id, variables: {
    approvalRequestId: duplicate.id, documentId: duplicate.documentId, creatorSub: duplicate.creatorSub,
    warehouseIds: [warehouseId], submittedAt: duplicate.createdAt.toISOString(),
    submittedDocumentVersion: 1, lineSnapshotSha256: hash,
  } });
  await reconcileApproval(db, engine, duplicate.id);
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: duplicate.id } })).haltReason,
    "DUPLICATE_PROCESS");
  assert.ok(pending.flowableProcessId);
  const revoked = await fixture();
  const { pending: open, taskId } = await start(revoked);
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: revoked.id, actorSub: actor.sub, decision: "approved", flowableTaskId: taskId,
    expectedVersion: open.version }));
  actor.active = false;
  try {
    await createFlowableDecider(db, engine, resolver)(message(revoked.id, { approvalRequestId: revoked.id,
      taskId, decision: "approved", intentVersion: intent.version, lineSnapshotSha256: hash,
      requestedAt: intent.decisionRequestedAt!.toISOString() }));
  } finally { actor.active = true; }
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: revoked.id } })).state, "pending");
  assert.equal((await engine.getTask(taskId)).id, taskId);
});

test.after(async () => { await db.$disconnect(); });

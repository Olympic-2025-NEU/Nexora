// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Actor } from "../../../platform/identity/actor";
import { backwardTrace, type BackwardEvent, type BackwardPort } from "./backward";

const actor = (role: string): Actor => ({ userId: "user", organizationId: "org",
  unitIds: [], roles: [role] });
const batchId = randomUUID();
const remoteBatch = randomUUID();
const sharedLotCode = "LOT-SAME";
const now = new Date("2026-11-23T08:00:00.000Z");
function event(type: string, issuer: string, batch = batchId): BackwardEvent {
  return { id: randomUUID(), issuerInstanceId: issuer, batchId: batch,
    originIssuerInstanceId: issuer, originLotId: sharedLotCode,
    eventType: type, documentId: randomUUID(), externalEventId: randomUUID(),
    payloadVersion: "1", summary: { sourceEventId: randomUUID(), secret: "must not leak" },
    occurredAt: now, createdAt: now, verificationState: "local_verified", outgoing: [] };
}
function port(roots: BackwardEvent[], others: BackwardEvent[] = [], pending = 0): BackwardPort {
  const all = new Map([...roots, ...others].map((row) => [row.id, row]));
  return { batchExists: async (id) => id === batchId,
    roots: async (_id, documentId) => roots.filter((row) => !documentId || row.documentId === documentId),
    event: async (id) => all.get(id) ?? null,
    pending: async () => ({ pending, seconds: pending ? 400 : 0 }) };
}

test("backward graph follows explicit branches, stops cycles and keeps issuer-qualified lots apart", async () => {
  const transfer = event("trading.transfer.confirmed.v1", "C");
  const issueA = event("trading.issue.confirmed.v1", "C", remoteBatch);
  const issueB = event("trading.issue.confirmed.v1", "B", randomUUID());
  const receipt = event("trading.receipt.confirmed.v1", "C");
  transfer.outgoing = [issueA, issueB].map((row) => ({ toEventId: row.id,
    missingRef: null, relation: "derived_from", verificationState: "local_verified" }));
  issueA.outgoing = [{ toEventId: transfer.id, missingRef: null,
    relation: "derived_from", verificationState: "local_verified" }];
  const result = await backwardTrace(port([transfer, receipt], [issueA, issueB]), actor("viewer"),
    { batchId, depth: 10 });
  assert.equal(result.nodes.length, 4);
  assert.equal(result.edges.length, 3);
  assert.equal(new Set(result.nodes.map((row) => row.eventId)).size, 4);
  assert.deepEqual(new Set(result.nodes.map((row) => row.issuerInstanceId)), new Set(["B", "C"]));
  assert.notEqual(issueA.batchId, issueB.batchId);
  assert.equal(issueA.originLotId, issueB.originLotId);
  assert.equal(result.edges.some((row) => row.fromEventId === receipt.id), false);
  assert.equal(JSON.stringify(result).includes("must not leak"), false);
});

test("backward graph exposes remote gap, projector lag and stable page snapshot", async () => {
  const receiving = event("trading.receiving.confirmed.v1", "C");
  const receipt = event("trading.receipt.confirmed.v1", "C");
  receiving.outgoing = [{ toEventId: null, missingRef: { issuerInstanceId: "B", eventId: "remote-1" },
    relation: "received_from", verificationState: "missing" }];
  const source = port([receiving, receipt], [], 1);
  const first = await backwardTrace(source, actor("staff"), { batchId, limit: 1 });
  assert.equal(first.nodes.length, 1);
  assert.equal(first.gaps.some((gap) => gap.reason === "remote_source_unavailable"), true);
  assert.equal(first.localProjection.state, "lagging");
  assert.ok(first.nextCursor);
  const second = await backwardTrace(source, actor("staff"),
    { batchId, limit: 1, cursor: first.nextCursor });
  assert.equal(second.asOf, first.asOf);
  assert.notEqual(second.nodes[0].eventId, first.nodes[0].eventId);
  assert.equal(second.nextCursor, undefined);
});

test("backward query denies partner and rejects unsafe bounds, cursor and unrelated document", async () => {
  const receipt = event("trading.receipt.confirmed.v1", "C");
  const source = port([receipt]);
  await assert.rejects(backwardTrace(source, actor("partner"), { batchId }),
    { code: "POLICY_DENIED" });
  await assert.rejects(backwardTrace(source, actor("viewer"), { batchId, depth: 11 }),
    { code: "TRACE_QUERY_INVALID" });
  await assert.rejects(backwardTrace(source, actor("viewer"), { batchId, cursor: "bad" }),
    { code: "CURSOR_INVALID" });
  await assert.rejects(backwardTrace(source, actor("viewer"), { batchId, cursor: "" }),
    { code: "CURSOR_INVALID" });
  await assert.rejects(backwardTrace(source, actor("viewer"), { batchId, documentId: "" }),
    { code: "TRACE_QUERY_INVALID" });
  await assert.rejects(backwardTrace(source, actor("viewer"),
    { batchId, documentId: randomUUID() }), { code: "TRACE_SOURCE_NOT_FOUND" });
});

test("depth bound marks a pending continuation without claiming its parent", async () => {
  const first = event("trading.transfer.confirmed.v1", "C");
  const middle = event("trading.issue.confirmed.v1", "C", remoteBatch);
  const last = event("trading.receipt.confirmed.v1", "C", randomUUID());
  first.outgoing = [{ toEventId: middle.id, missingRef: null,
    relation: "derived_from", verificationState: "local_verified" }];
  middle.outgoing = [{ toEventId: last.id, missingRef: null,
    relation: "derived_from", verificationState: "local_verified" }];
  const result = await backwardTrace(port([first], [middle, last]), actor("viewer"),
    { batchId, depth: 1 });
  assert.equal(result.nodes.length, 2);
  assert.ok(result.gaps.some((gap) => gap.reason === "depth_limit"));
});

test("same lot code in another issuer is not traversed without a source link", async () => {
  const local = event("trading.receipt.confirmed.v1", "C", batchId);
  const other = event("trading.receipt.confirmed.v1", "B", remoteBatch);
  const result = await backwardTrace(port([local], [other]), actor("viewer"), { batchId });
  assert.deepEqual(result.nodes.map((node) => node.eventId), [local.id]);
  assert.equal(result.nodes[0].originLot.lotId, other.originLotId);
  const empty = await backwardTrace(port([]), actor("viewer"), { batchId });
  assert.equal(empty.gaps[0].reason, "local_source_unavailable");
});

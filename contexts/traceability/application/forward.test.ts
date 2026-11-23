// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Actor } from "../../../platform/identity/actor";
import { forwardTrace, type ForwardEvent, type ForwardPort, type ImpactLine } from "./forward";

const batchId = randomUUID();
const actor = (role: string): Actor => ({ userId: "fixture", organizationId: "fixture",
  unitIds: [randomUUID()], roles: [role] });
const now = new Date("2026-11-24T00:00:00.000Z");
function event(type: string, issuer = "A", batch = batchId): ForwardEvent {
  return { id: randomUUID(), issuerInstanceId: issuer, batchId: batch,
    originIssuerInstanceId: "A", originLotId: "LOT-1", eventType: type,
    documentId: randomUUID(), externalEventId: randomUUID(), payloadVersion: "1",
    summary: { sourceEventId: randomUUID(), buyerRef: "private-buyer" },
    occurredAt: now, createdAt: now, verificationState: "local_verified", incoming: [] };
}
function port(roots: ForwardEvent[], other: ForwardEvent[] = [], rows: ImpactLine[] = [],
  pending = 0): ForwardPort {
  const all = new Map([...roots, ...other].map((item) => [item.id, item]));
  return { batchExists: async (id) => id === batchId,
    roots: async () => roots, event: async (id) => all.get(id) ?? null,
    impact: async (events) => rows.filter((row) => events.some((item) => item.id === row.eventId)),
    pending: async () => ({ pending, seconds: pending ? 500 : 0 }) };
}
function quantity(eventId: string, kind: ImpactLine["kind"], amount: string,
  partner?: ImpactLine["partner"]): ImpactLine {
  return { eventId, sourceDocumentId: randomUUID(), sourceLineId: randomUUID(),
    kind, quantity: amount, uomId: randomUUID(), verificationState: "confirmed",
    ...(partner ? { partner } : {}) };
}

test("forward follows two transfer branches and sale, dedupes cycle and marks unknown downstream", async () => {
  const issue = event("trading.issue.confirmed.v1");
  const transferA = event("trading.transfer.confirmed.v1");
  const transferB = event("trading.transfer.confirmed.v1");
  const sale = event("trading.sale.recorded.v1");
  issue.incoming = [transferA, transferB, sale].map((row) => ({ fromEventId: row.id,
    relation: "derived_from", verificationState: "local_verified" }));
  transferA.incoming = [{ fromEventId: issue.id, relation: "derived_from",
    verificationState: "local_verified" }];
  const rows = [quantity(issue.id, "issue", "8"),
    quantity(transferA.id, "transfer", "3", { id: randomUUID(), issuerInstanceId: "B" }),
    quantity(transferB.id, "transfer", "2", { id: randomUUID(), issuerInstanceId: "C" }),
    quantity(sale.id, "sale", "1")];
  const result = await forwardTrace(port([issue], [transferA, transferB, sale], rows),
    actor("viewer"), { batchId, depth: 10 });
  assert.equal(result.nodes.length, 4);
  assert.equal(new Set(result.nodes.map((node) => node.eventId)).size, 4);
  assert.equal(result.edges.length, 4);
  assert.equal(result.impact.length, 4);
  assert.equal(result.gaps.filter((gap) => gap.reason === "downstream_unreported").length, 2);
  assert.deepEqual(new Set(result.gaps.map((gap) => gap.partnerIssuerInstanceId).filter(Boolean)),
    new Set(["B", "C"]));
  assert.equal(JSON.stringify(result).includes("private-buyer"), false);
});

test("forward shows partial receiving as actual and sent, with no fictitious remote child", async () => {
  const receiving = event("trading.receiving.confirmed.v1", "C");
  const row = { ...quantity(receiving.id, "receiving", "6"), sentQuantity: "8",
    actualQuantity: "6", partner: { issuerInstanceId: "B" } };
  const result = await forwardTrace(port([receiving], [], [row], 1), actor("staff"), { batchId });
  assert.equal(result.impact[0].quantity, "6");
  assert.equal(result.impact[0].sentQuantity, "8");
  assert.equal(result.nodes.length, 1);
  assert.equal(result.localProjection.state, "lagging");
  assert.ok(result.gaps.some((gap) => gap.reason === "projection_pending"));
});

test("forward cursor, depth and role boundaries fail closed", async () => {
  const first = event("trading.issue.confirmed.v1");
  const second = event("trading.sale.recorded.v1");
  first.incoming = [{ fromEventId: second.id, relation: "derived_from",
    verificationState: "local_verified" }];
  const source = port([first], [second]);
  const page = await forwardTrace(source, actor("viewer"), { batchId, limit: 1 });
  assert.ok(page.nextCursor);
  const next = await forwardTrace(source, actor("viewer"),
    { batchId, limit: 1, cursor: page.nextCursor });
  assert.equal(page.asOf, next.asOf);
  assert.notEqual(page.nodes[0].eventId, next.nodes[0].eventId);
  await assert.rejects(forwardTrace(source, actor("partner"), { batchId }),
    { code: "POLICY_DENIED" });
  await assert.rejects(forwardTrace(source, actor("viewer"), { batchId, depth: 11 }),
    { code: "TRACE_QUERY_INVALID" });
  await assert.rejects(forwardTrace(source, actor("viewer"), { batchId, cursor: "bad" }),
    { code: "CURSOR_INVALID" });
});

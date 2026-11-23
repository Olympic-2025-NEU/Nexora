// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildPassportPayload, parsePassportAccess } from "./passport-policy";

const publicAccess = { organization: "public", product: "public", batch: "public",
  timeline: "public", evidence: "private" } as const;
const now = new Date("2026-11-24T00:00:00.000Z");

test("passport policy requires an exact five-category visibility map", () => {
  assert.deepEqual(parsePassportAccess(publicAccess), publicAccess);
  for (const value of [{ ...publicAccess, stock: "public" },
    { ...publicAccess, evidence: "all" }, { product: "public" }, null]) {
    assert.throws(() => parsePassportAccess(value), { code: "PASSPORT_POLICY_INVALID" });
  }
});

test("public projection copies only seven allowlisted fields from confirmed trace", () => {
  const eventId = randomUUID();
  const result = buildPassportPayload(publicAccess, {
    productName: "Cà phê", publicLotCode: "LOT-1", originIssuer: "A",
    approvedAt: now,
    events: [{ id: eventId, type: "trading.receipt.confirmed.v1", occurredAt: now,
      recordedAt: now, verificationState: "local_verified", confirmed: true,
      links: [] }, { id: randomUUID(), type: "trading.sale.recorded.v1",
      occurredAt: now, recordedAt: now, verificationState: "partner_asserted",
      confirmed: false, links: [] }],
    buyerRef: "PRIVATE_BUYER", stockBalance: 100, secret: "PRIVATE_SECRET",
  } as Parameters<typeof buildPassportPayload>[1] & Record<string, unknown>);
  assert.deepEqual(Object.keys(result.payload).sort(), ["productName", "publicLotCode",
    "originIssuer", "timeline", "verificationState", "gaps", "asOf"].sort());
  assert.equal(result.sourceEventIds.length, 1);
  assert.ok(result.payload.gaps.includes("partner_source_unverified"));
  assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
});

test("private timeline is withheld and missing source stays explicit", () => {
  const result = buildPassportPayload({ ...publicAccess, timeline: "private" }, {
    productName: "Coffee", publicLotCode: "L1", originIssuer: "A", approvedAt: now,
    events: [{ id: randomUUID(), type: "trading.issue.confirmed.v1", occurredAt: now,
      recordedAt: now, verificationState: "local_verified", confirmed: true,
      links: [{ toEventId: null, missingRef: { issuerInstanceId: "B", eventId: "remote" } }] }],
  });
  assert.deepEqual(result.payload.timeline, []);
  assert.ok(result.payload.gaps.includes("timeline_not_disclosed"));
  assert.ok(result.payload.gaps.includes("remote_source_unavailable"));
  assert.ok(result.payload.gaps.includes("local_allocation_unknown"));
  assert.throws(() => buildPassportPayload({ ...publicAccess, batch: "partner" }, {
    productName: "Coffee", publicLotCode: "L1", originIssuer: "A",
    approvedAt: now, events: [],
  }), { code: "PASSPORT_NOT_PUBLIC" });
});

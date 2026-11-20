// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createPrismaIdempotency, hashPayload, validateIdempotencyKey } from "./idempotency";

it("hashes JCS payload, independent of object key order", () => {
  const expected = createHash("sha256").update('{"a":1,"b":2}').digest("hex");
  assert.equal(hashPayload({ b: 2, a: 1 }), expected);
  assert.equal(hashPayload({ a: 1, b: 2 }), expected);
  assert.notEqual(hashPayload({ a: 1 }), expected);
  assert.equal(hashPayload(null).length, 64);
});

it("validates idempotency keys at input boundary", () => {
  validateIdempotencyKey("A._:-0123456789ab");
  validateIdempotencyKey("x".repeat(128));
  for (const value of ["x".repeat(15), "x".repeat(129), "space in key 123456", "é".repeat(16)]) {
    assert.throws(() => validateIdempotencyKey(value), { code: "IDEMPOTENCY_KEY_INVALID" });
  }
});

it("lookup maps stored state, hash mismatch, and expiry", async () => {
  const scope = { key: "valid-key-12345678", actorOrClient: "user", method: "POST", routeKey: "action", payloadSha256: "a".repeat(64) };
  let record: Record<string, unknown> | null = null;
  const fake = { idempotencyRecord: { findUnique: async () => record } } as unknown as PrismaClient;
  const port = createPrismaIdempotency(fake);
  assert.deepEqual(await port.lookup(scope), { kind: "fresh" });
  record = { expiresAt: new Date(Date.now() + 100_000), payloadSha256: scope.payloadSha256,
    state: "completed", responseBody: { id: "saved" } };
  assert.deepEqual(await port.lookup(scope), { kind: "replay", result: { id: "saved" } });
  await assert.rejects(port.lookup({ ...scope, payloadSha256: "b".repeat(64) }), { code: "IDEMPOTENCY_CONFLICT" });
  record = { ...record, expiresAt: new Date(0) };
  assert.deepEqual(await port.lookup({ ...scope, payloadSha256: "b".repeat(64) }), { kind: "fresh" });
});

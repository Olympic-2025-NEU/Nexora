// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import manifest from "./fixtures/manifest-v1.json";
import { classifyFederationReplay, FederationContractError, federationHash,
  validateFederationEnvelope } from "./federation";

const raw = (file: string) => readFileSync(`contracts/events/fixtures/${file}`, "utf8");
const parse = (file: string, receiverInstanceId: string, partnerIssuerInstanceId: string) =>
  validateFederationEnvelope(raw(file), { receiverInstanceId, partnerIssuerInstanceId,
    now: new Date("2026-11-14T08:00:01Z") });

test("sender and receiver independently agree on every v1 schema and JCS hash", () => {
  for (const entry of manifest.valid) {
    const sender = parse(entry.file, entry.receiver, entry.partnerIssuer);
    const receiver = validateFederationEnvelope(JSON.stringify(sender.envelope), {
      receiverInstanceId: entry.receiver, partnerIssuerInstanceId: entry.partnerIssuer,
      now: new Date("2026-11-14T08:00:01Z"),
    });
    assert.equal(sender.hash, entry.sha256);
    assert.equal(receiver.hash, sender.hash);
    assert.equal(federationHash(receiver.envelope), entry.sha256);
  }
});

test("receiver rejects invalid fixtures with protocol error codes", () => {
  for (const entry of manifest.invalid) {
    assert.throws(() => parse(entry.file, entry.receiver, entry.partnerIssuer), FederationContractError,
      entry.file);
  }
  const valid = JSON.parse(raw(manifest.valid[0].file));
  assert.throws(() => validateFederationEnvelope(JSON.stringify({ ...valid, schemaVersion: "2.0" })),
    { code: "UNSUPPORTED_SCHEMA", status: 422 });
  assert.throws(() => validateFederationEnvelope(JSON.stringify({ ...valid, lots: [
    { ...valid.lots[0], quantity: "1.0000" }] })), { code: "INVALID_EVENT_PAYLOAD", status: 422 });
  assert.throws(() => validateFederationEnvelope(JSON.stringify({ ...valid, privateUrl: "secret" })),
    { code: "INVALID_EVENT_PAYLOAD", status: 422 });
  assert.throws(() => validateFederationEnvelope(raw(manifest.valid[0].file).padEnd(256 * 1024 + 1)),
    { code: "PAYLOAD_TOO_LARGE", status: 413 });
  assert.equal(parse(manifest.valid[0].file, "B", "A").clockSkewWarning, false);
  assert.equal(validateFederationEnvelope(raw(manifest.valid[0].file), {
    now: new Date("2026-11-15T08:00:01Z") }).clockSkewWarning, true);
});

test("same issuer and message ID with same hash replays ACK; changed hash conflicts", () => {
  const reference = parse(manifest.valid[0].file, "B", "A");
  const ack = { messageId: reference.envelope.messageId, status: "validated" };
  const existing = { issuerInstanceId: "A", messageId: reference.envelope.messageId,
    eventId: reference.envelope.eventId, eventType: reference.envelope.eventType,
    hash: reference.hash, ack };
  assert.deepEqual(classifyFederationReplay(existing, reference), { kind: "replay", ack });
  for (const vector of manifest.replay) {
    const candidate = parse(vector.file, "B", "A");
    if (vector.sameHash) assert.deepEqual(classifyFederationReplay(existing, candidate), { kind: "replay", ack });
    else assert.throws(() => classifyFederationReplay(existing, candidate),
      { code: "MESSAGE_ID_REUSED", status: 409 });
  }
  const newMessage = { ...reference.envelope, messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.throws(() => classifyFederationReplay(existing,
    { envelope: newMessage, hash: federationHash(newMessage) }),
  { code: "EVENT_ID_REUSED", status: 409 });
});

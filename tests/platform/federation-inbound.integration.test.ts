// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { FederationContractError } from "../../contracts/events/federation";
import { receiveFederationEvent } from "../../contexts/federation/application/receive-event";
import type { PartnerActor } from "../../platform/identity/partner-actor";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.APP_DATABASE_URL)
  throw Error("Isolated database required");
const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const db = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
after(async () => { await db.$disconnect(); await owner.$disconnect(); });
const partnerId = randomUUID();
const actor: PartnerActor = { type: "partner", clientId: "sender-a", partnerId,
  partnerCode: "A", issuerInstanceId: "A", allowedScope: "federation:write" };
const fixture = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
function message(patch: Record<string, unknown> = {}) {
  return JSON.stringify({ ...fixture, messageId: randomUUID(), eventId: randomUUID(), ...patch });
}
async function rejects(raw: string, code: string, status: number, who = actor) {
  await assert.rejects(() => receiveFederationEvent(db, raw, who, "B"),
    (error: unknown) => error instanceof FederationContractError && error.code === code && error.status === status);
}

test("trusted inbox stores exact ACK, rejects replay conflicts and leaves stock untouched", async () => {
  await owner.partner.create({ data: { id: partnerId, issuerInstanceId: "A", code: "A",
    displayName: "Sender A", createdBySub: "fixture" } });
  await owner.partnerConnection.create({ data: { id: randomUUID(), partnerId,
    endpointUrl: "https://sender.invalid/api/v1/federation/events",
    outboundTokenUrl: "https://sender.invalid/token", outboundClientId: "receiver-b",
    outboundSecretRef: "fixture", outboundAudience: "nexora", inboundClientId: actor.clientId,
    allowedInboundScope: "federation:write" } });
  const raw = message();
  const ack = await receiveFederationEvent(db, raw, actor, "B");
  assert.equal(ack.status, "validated");
  assert.equal(ack.messageId, JSON.parse(raw).messageId);
  assert.deepEqual(await receiveFederationEvent(db, raw, actor, "B"), ack);
  const parsed = JSON.parse(raw);
  await rejects(JSON.stringify({ ...parsed, sentQuantity: "11" }), "INVALID_EVENT_PAYLOAD", 422);
  await rejects(JSON.stringify({ ...parsed, publishedAt: "2026-11-14T08:00:02Z" }), "MESSAGE_ID_REUSED", 409);
  await rejects(message({ eventId: parsed.eventId }), "EVENT_ID_REUSED", 409);
  await rejects(message({ issuerInstanceId: "spoof" }), "WRONG_ISSUER", 403);
  await rejects(message({ recipientInstanceId: "C" }), "WRONG_RECIPIENT", 403);
  await rejects(message({ sharingPolicyVersion: "v2" }), "UNSUPPORTED_SHARING_POLICY", 422);
  await rejects(message({ schemaVersion: "2.0" }), "UNSUPPORTED_SCHEMA", 422);
  assert.equal(await db.inboxMessage.count(), 1);
  assert.equal(await db.partnerAck.count(), 1);
  assert.equal(await db.stockMovement.count(), 0);
  const inbox = await db.inboxMessage.findFirstOrThrow({ include: { ack: true } });
  assert.equal(inbox.ack?.responseBody && (inbox.ack.responseBody as { ackId: string }).ackId, ack.ackId);
  await owner.partnerConnection.update({ where: { partnerId }, data: { status: "disabled" } });
  await rejects(message(), "PARTNER_INACTIVE_OR_UNBOUND", 403);
  await owner.partnerConnection.update({ where: { partnerId }, data: { status: "active" } });
  await owner.partner.update({ where: { id: partnerId }, data: { status: "suspended" } });
  await rejects(message(), "PARTNER_INACTIVE_OR_UNBOUND", 403);
  await owner.partner.update({ where: { id: partnerId }, data: { status: "active" } });
});

test("parallel retransmissions persist one inbox and one ACK", async () => {
  const raw = message();
  const acknowledgements = await Promise.all(Array.from({ length: 12 }, () =>
    receiveFederationEvent(db, raw, actor, "B")));
  assert.ok(acknowledgements.every((ack) => ack.ackId === acknowledgements[0].ackId));
  assert.equal(await db.inboxMessage.count({ where: { messageId: JSON.parse(raw).messageId } }), 1);
});

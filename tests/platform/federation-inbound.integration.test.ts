// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { FederationContractError } from "../../contracts/events/federation";
import { receiveFederationEvent } from "../../contexts/federation/application/receive-event";
import { bindExternalLot, MappingError, resolvePendingDependencies } from
  "../../contexts/federation/application/identity-mapping";
import type { PartnerActor } from "../../platform/identity/partner-actor";
import { createAnnouncementService } from "../../contexts/trading/application/inbound-announcements";
import { createPrismaAnnouncementSource } from "../../contexts/trading/infrastructure/inbound-announcements";

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
  assert.equal(ack.status, "pending_dependency");
  assert.equal(ack.messageId, JSON.parse(raw).messageId);
  const pendingReceipt = await db.$transaction((tx) => createAnnouncementService(
    createPrismaAnnouncementSource(tx), "B").resolveVerifiedAnnouncement(ack.messageId));
  assert.equal(pendingReceipt.sourceDocument.id, fixture.sourceDocument.id);
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

async function makeBatch(originIssuer: string, originLotId: string) {
  const productId = randomUUID();
  const variantId = randomUUID();
  const batchId = randomUUID();
  await owner.$executeRaw`INSERT INTO catalog.product(id,name,category_id,created_by_sub)
    VALUES (${productId}::uuid,'Shared product name','bbbbbbbb-0001-4000-8000-000000000001','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id,product_id,sku,created_by_sub)
    VALUES (${variantId}::uuid,${productId}::uuid,${randomUUID()},'fixture')`;
  await owner.batch.create({ data: { id: batchId, productId, productVariantId: variantId,
    localCode: "SAME-LOT-CODE", originIssuerInstanceId: originIssuer,
    originLotId, createdBySub: "fixture" } });
  return batchId;
}

test("issuer-qualified mapping creates only allowlisted partner provenance", async () => {
  const raw = message();
  const envelope = JSON.parse(raw);
  const ack = await receiveFederationEvent(db, raw, actor, "B");
  assert.equal(ack.status, "pending_dependency");
  const inbox = await db.inboxMessage.findFirstOrThrow({ where: { messageId: envelope.messageId } });
  const lot = envelope.lots[0];
  const batchId = await makeBatch("A", lot.originLot.lotId);
  const otherIssuerBatch = await makeBatch("OTHER", lot.originLot.lotId);
  await assert.rejects(() => bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: otherIssuerBatch }, ["staff"]),
    (error: unknown) => error instanceof MappingError && error.code === "LOCAL_BATCH_ORIGIN_MISMATCH");
  await assert.rejects(() => bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["viewer"]),
    (error: unknown) => error instanceof MappingError && error.code === "MAPPING_FORBIDDEN");
  const mappingId = await bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["staff"]);
  assert.equal(await bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["staff"]), mappingId);
  assert.equal((await db.inboxMessage.findUniqueOrThrow({ where: { id: inbox.id } })).state, "applied_to_trace");
  const trace = await db.traceEvent.findFirstOrThrow({ where: { sourceMessageId: inbox.id } });
  assert.equal(trace.batchId, batchId);
  assert.equal(trace.originIssuerInstanceId, "A");
  assert.equal(trace.verificationState, "partner_asserted");
  assert.equal((trace.summary as { sharingPolicyVersion: string }).sharingPolicyVersion, "v1");
  assert.equal("product" in (trace.summary as object), false);
  assert.equal(await db.stockMovement.count(), 0);
});

test("B to C child before parent keeps a gap and resolves it exactly once", async () => {
  const bPartnerId = randomUUID();
  await owner.partner.create({ data: { id: bPartnerId, issuerInstanceId: "B",
    code: "B", displayName: "Sender B", createdBySub: "fixture" } });
  await owner.partnerConnection.create({ data: { id: randomUUID(), partnerId: bPartnerId,
    endpointUrl: "https://sender-b.invalid/events", outboundTokenUrl: "https://sender-b.invalid/token",
    outboundClientId: "receiver-c", outboundSecretRef: "fixture", outboundAudience: "nexora",
    inboundClientId: "sender-b", allowedInboundScope: "federation:write" } });
  const bActor: PartnerActor = { ...actor, clientId: "sender-b", partnerId: bPartnerId,
    partnerCode: "B", issuerInstanceId: "B" };
  const child = JSON.parse(readFileSync("contracts/events/fixtures/b-to-c-transfer-announced.json", "utf8"));
  child.messageId = randomUUID(); child.eventId = randomUUID();
  child.lots[0].originLot.lotId = randomUUID();
  child.upstreamReferences = [{ issuerInstanceId: "A", messageId: randomUUID(), eventId: randomUUID() }];
  const childAck = await receiveFederationEvent(db, JSON.stringify(child), bActor, "C");
  assert.equal(childAck.status, "pending_dependency");
  const childInbox = await db.inboxMessage.findFirstOrThrow({ where: { messageId: child.messageId } });
  const origin = child.lots[0].originLot;
  const localBatchId = await makeBatch(origin.issuerInstanceId, origin.lotId);
  await bindExternalLot(db, { inboxId: childInbox.id,
    sourceLineId: child.lots[0].sourceLineId, localBatchId }, ["staff"]);
  const childTrace = await db.traceEvent.findFirstOrThrow({ where: { sourceMessageId: childInbox.id } });
  assert.equal(childTrace.issuerInstanceId, "B");
  assert.equal(childTrace.originIssuerInstanceId, "A");
  assert.equal((await db.traceLink.findFirstOrThrow({ where: { fromEventId: childTrace.id } })).verificationState, "missing");

  const parent = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
  parent.messageId = child.upstreamReferences[0].messageId;
  parent.eventId = child.upstreamReferences[0].eventId;
  parent.recipientInstanceId = "C";
  parent.lots[0].originLot.lotId = child.lots[0].originLot.lotId;
  parent.lots[0].senderBatch.batchId = child.lots[0].originLot.lotId;
  const parentAck = await receiveFederationEvent(db, JSON.stringify(parent), actor, "C");
  assert.equal(parentAck.status, "pending_dependency");
  const parentInbox = await db.inboxMessage.findFirstOrThrow({ where: { messageId: parent.messageId } });
  await bindExternalLot(db, { inboxId: parentInbox.id,
    sourceLineId: parent.lots[0].sourceLineId, localBatchId }, ["staff"]);
  assert.equal(await resolvePendingDependencies(db), 0);
  const parentTrace = await db.traceEvent.findFirstOrThrow({ where: { sourceMessageId: parentInbox.id } });
  const link = await db.traceLink.findFirstOrThrow({ where: { fromEventId: childTrace.id } });
  assert.equal(link.toEventId, parentTrace.id);
  assert.equal(link.missingRef, null);
  assert.equal(link.verificationState, "partner_asserted");
  assert.equal(await db.traceLink.count({ where: { fromEventId: childTrace.id } }), 1);
  assert.equal((await db.inboxMessage.findUniqueOrThrow({ where: { id: childInbox.id } })).state, "applied_to_trace");
});

test("dependency cycles and wrong sender assertion are rejected before persistence", async () => {
  const cycle = JSON.parse(message());
  cycle.upstreamReferences = [{ issuerInstanceId: "A", messageId: cycle.messageId,
    eventId: cycle.eventId }];
  await assert.rejects(() => receiveFederationEvent(db, JSON.stringify(cycle), actor, "B"),
    (error: unknown) => error instanceof MappingError && error.code === "DEPENDENCY_CYCLE");
  assert.equal(await db.inboxMessage.count({ where: { messageId: cycle.messageId } }), 0);
  const spoof = JSON.parse(message());
  spoof.lots[0].senderBatch.instanceId = "C";
  await assert.rejects(() => receiveFederationEvent(db, JSON.stringify(spoof), actor, "B"),
    (error: unknown) => error instanceof MappingError && error.code === "SENDER_BATCH_ISSUER_MISMATCH");
  assert.equal(await db.inboxMessage.count({ where: { messageId: spoof.messageId } }), 0);
});

test("late parent with a different origin marks the child rejected", async () => {
  const bPartner = await db.partner.findUniqueOrThrow({ where: { issuerInstanceId: "B" } });
  const bActor: PartnerActor = { ...actor, clientId: "sender-b", partnerId: bPartner.id,
    partnerCode: "B", issuerInstanceId: "B" };
  const child = JSON.parse(readFileSync("contracts/events/fixtures/b-to-c-transfer-announced.json", "utf8"));
  child.messageId = randomUUID(); child.eventId = randomUUID();
  child.lots[0].originLot.lotId = randomUUID();
  child.upstreamReferences = [{ issuerInstanceId: "A", messageId: randomUUID(), eventId: randomUUID() }];
  await receiveFederationEvent(db, JSON.stringify(child), bActor, "C");
  const childInbox = await db.inboxMessage.findFirstOrThrow({ where: { messageId: child.messageId } });
  const localBatchId = await makeBatch("A", child.lots[0].originLot.lotId);
  await bindExternalLot(db, { inboxId: childInbox.id,
    sourceLineId: child.lots[0].sourceLineId, localBatchId }, ["staff"]);
  const parent = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
  parent.messageId = child.upstreamReferences[0].messageId;
  parent.eventId = child.upstreamReferences[0].eventId;
  parent.recipientInstanceId = "C";
  parent.lots[0].originLot.lotId = randomUUID();
  await receiveFederationEvent(db, JSON.stringify(parent), actor, "C");
  const updated = await db.inboxMessage.findUniqueOrThrow({ where: { id: childInbox.id } });
  assert.equal(updated.state, "rejected");
  assert.equal(updated.errorCode, "UNKNOWN_LOT_MAPPING");
});

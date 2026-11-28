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
import { publishTraceSummary } from "../../contexts/federation/application/publish-trace-summary";
import { backwardTrace } from "../../contexts/traceability/application/backward";
import { createPrismaBackwardPort } from "../../contexts/traceability/infrastructure/backward-repo";
import { forwardTrace } from "../../contexts/traceability/application/forward";
import { createPrismaForwardPort } from "../../contexts/traceability/infrastructure/forward-repo";

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
  await rejects(`${message()}${" ".repeat(256 * 1024)}`, "PAYLOAD_TOO_LARGE", 413);
  const skewed = message({ publishedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal((await receiveFederationEvent(db, skewed, actor, "B")).status, "pending_dependency");
  assert.equal(await db.inboxMessage.count(), 2);
  assert.equal(await db.partnerAck.count(), 2);
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
    sourceLineId: lot.sourceLineId, localBatchId: otherIssuerBatch }, ["inventory_clerk"]),
    (error: unknown) => error instanceof MappingError && error.code === "LOCAL_BATCH_ORIGIN_MISMATCH");
  await assert.rejects(() => bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["viewer"]),
    (error: unknown) => error instanceof MappingError && error.code === "MAPPING_FORBIDDEN");
  const mappingId = await bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["inventory_clerk"]);
  assert.equal(await bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: lot.sourceLineId, localBatchId: batchId }, ["inventory_clerk"]), mappingId);
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
    sourceLineId: child.lots[0].sourceLineId, localBatchId }, ["inventory_clerk"]);
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
    sourceLineId: parent.lots[0].sourceLineId, localBatchId }, ["inventory_clerk"]);
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
    sourceLineId: child.lots[0].sourceLineId, localBatchId }, ["inventory_clerk"]);
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

test("C caches B's public A summary, resolves an offline upstream gap and honors revocation", async () => {
  const bPartner = await db.partner.findUniqueOrThrow({ where: { issuerInstanceId: "B" } });
  const bActor: PartnerActor = { ...actor, clientId: "sender-b", partnerId: bPartner.id,
    partnerCode: "B", issuerInstanceId: "B" };
  const child = JSON.parse(readFileSync("contracts/events/fixtures/b-to-c-transfer-announced.json", "utf8"));
  child.messageId = randomUUID(); child.eventId = randomUUID();
  child.lots[0].originLot.lotId = randomUUID();
  child.upstreamReferences = [{ issuerInstanceId: "A", messageId: randomUUID(), eventId: randomUUID() }];
  await receiveFederationEvent(db, JSON.stringify(child), bActor, "C");
  const inbox = await db.inboxMessage.findFirstOrThrow({ where: { messageId: child.messageId } });
  const batchId = await makeBatch("A", child.lots[0].originLot.lotId);
  await bindExternalLot(db, { inboxId: inbox.id,
    sourceLineId: child.lots[0].sourceLineId, localBatchId: batchId }, ["inventory_clerk"]);
  const childTrace = await db.traceEvent.findFirstOrThrow({ where: { sourceMessageId: inbox.id } });
  assert.equal((await db.traceLink.findFirstOrThrow({ where: { fromEventId: childTrace.id } })).toEventId, null);
  const remoteEventId = `${child.upstreamReferences[0].eventId}:${randomUUID()}`;
  const item = { issuerInstanceId: "A", externalEventId: remoteEventId,
    eventType: "transfer.announced.v1", occurredAt: new Date().toISOString(),
    disclosureScope: "public", policyVersion: 1, state: "active", parents: [],
    sourceMessageRef: child.upstreamReferences[0] };
  const own = { issuerInstanceId: "B", externalEventId: `${child.eventId}:${child.lots[0].sourceLineId}`,
    eventType: "transfer.announced.v1", occurredAt: new Date().toISOString(),
    disclosureScope: "partner", policyVersion: 1, state: "active", parents: [] };
  const summary = { schemaVersion: "1.0", messageId: randomUUID(), eventId: randomUUID(),
    eventType: "trace.summary.v1", issuerInstanceId: "B", recipientInstanceId: "C",
    occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
    correlationId: randomUUID(), causationId: randomUUID(),
    sourceDocument: { type: "trace_summary", id: randomUUID(), version: 1 },
    lots: [], upstreamReferences: [], evidence: [], sharingPolicyVersion: "v1",
    targetLot: { originLot: child.lots[0].originLot, senderBatch: child.lots[0].senderBatch },
    traceSummaries: [item, own] };
  const forbidden = structuredClone(summary);
  forbidden.messageId = randomUUID(); forbidden.eventId = randomUUID();
  forbidden.traceSummaries[0].disclosureScope = "partner";
  await assert.rejects(() => receiveFederationEvent(db, JSON.stringify(forbidden), bActor, "C"),
    (error: unknown) => error instanceof MappingError && error.code === "RELAY_NOT_ALLOWED");
  await receiveFederationEvent(db, JSON.stringify(summary), bActor, "C");
  const remote = await db.traceEvent.findUniqueOrThrow({ where: {
    issuerInstanceId_externalEventId: { issuerInstanceId: "A", externalEventId: remoteEventId } } });
  assert.equal(remote.verificationState, "partner_asserted");
  assert.equal(remote.batchId, batchId);
  const linked = await db.traceLink.findFirstOrThrow({ where: { fromEventId: childTrace.id } });
  assert.equal(linked.toEventId, remote.id);
  assert.equal(await db.stockMovement.count(), 0);
  const reader = { userId: "fixture", organizationId: "fixture", unitIds: [],
    roles: ["administrator"] };
  const graph = () => backwardTrace(createPrismaBackwardPort(db, reader), reader,
    { batchId, depth: 10, limit: 100 });
  assert.equal((await graph()).nodes.find((node) => node.eventId === childTrace.id)?.syncState,
    "cached");
  await db.federatedTraceSummary.update({ where: { issuerInstanceId_externalEventId: {
    issuerInstanceId: "B", externalEventId: own.externalEventId } }, data: {
    refreshedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
  assert.equal((await graph()).nodes.find((node) => node.eventId === childTrace.id)?.syncState,
    "stale");
  const revoked = structuredClone(summary);
  revoked.messageId = randomUUID(); revoked.eventId = randomUUID();
  revoked.traceSummaries[0].state = "revoked";
  await receiveFederationEvent(db, JSON.stringify(revoked), bActor, "C");
  assert.equal((await db.federatedTraceSummary.findUniqueOrThrow({ where: {
    issuerInstanceId_externalEventId: { issuerInstanceId: "A", externalEventId: remoteEventId } } })).state,
  "revoked");
  const wrongLot = structuredClone(summary);
  wrongLot.messageId = randomUUID(); wrongLot.eventId = randomUUID();
  wrongLot.targetLot.originLot.lotId = randomUUID();
  wrongLot.targetLot.senderBatch.batchId = randomUUID();
  const unrelatedBatchId = await makeBatch("A", wrongLot.targetLot.originLot.lotId);
  await db.identityMapping.create({ data: { id: randomUUID(),
    senderInstanceId: "B", senderBatchId: wrongLot.targetLot.senderBatch.batchId,
    originIssuerInstanceId: "A", originLotId: wrongLot.targetLot.originLot.lotId,
    localBatchId: unrelatedBatchId, sourceMessageId: inbox.id,
    verificationState: "partner_asserted" } });
  await assert.rejects(() => receiveFederationEvent(db, JSON.stringify(wrongLot), bActor, "C"),
    (error: unknown) => error instanceof MappingError && error.code === "TRACE_SOURCE_CONFLICT");
});

test("publisher relays only approved allowlisted timeline events", async () => {
  const batchId = await makeBatch("A", randomUUID());
  const cPartnerId = randomUUID();
  await owner.partner.create({ data: { id: cPartnerId, issuerInstanceId: "C",
    code: "C", displayName: "Receiver C", createdBySub: "fixture" } });
  await owner.partnerConnection.create({ data: { id: randomUUID(), partnerId: cPartnerId,
    endpointUrl: "https://receiver-c.invalid/events", outboundTokenUrl: "https://receiver-c.invalid/token",
    outboundClientId: "sender-b-to-c", outboundSecretRef: "fixture", outboundAudience: "nexora",
    inboundClientId: "receiver-c", allowedInboundScope: "federation:write" } });
  await owner.passportPolicy.create({ data: { id: randomUUID(), batchId,
    policyVersion: 1, state: "approved", timelineVisibility: "partner",
    createdBySub: "fixture", approvedBySub: "fixture", approvedAt: new Date() } });
  const batch = await db.batch.findUniqueOrThrow({ where: { id: batchId } });
  const warehouseId = randomUUID();
  await owner.warehouse.create({ data: { id: warehouseId, code: `TEST-${randomUUID().slice(0, 8)}`,
    name: "Fixture", status: "active", createdBySub: "fixture" } });
  const uom = await owner.uom.create({ data: { id: randomUUID(), code: "EA",
    name: "Each", nameKey: `each-${randomUUID()}`, kind: "count" } });
  await owner.productVariantUom.create({ data: { id: randomUUID(),
    productVariantId: batch.productVariantId, uomId: uom.id,
    factorToStockUom: 1, isStockKeeping: true } });
  const documentId = randomUUID();
  await owner.document.create({ data: { id: documentId, documentType: "goods_receipt",
    documentNumber: `TEST-${randomUUID()}`, status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await owner.documentLine.create({ data: { id: randomUUID(), documentId,
    lineNo: 1, warehouseId, batchId, productId: batch.productId,
    productVariantId: batch.productVariantId, uomId: uom.id, quantity: 1 } });
  await owner.document.update({ where: { id: documentId }, data: { status: "confirmed",
    confirmedBySub: "fixture", confirmedAt: new Date() } });
  const localId = randomUUID();
  await owner.traceEvent.create({ data: { id: randomUUID(), issuerInstanceId: "B",
    externalEventId: localId, eventType: "trading.receipt.confirmed.v1",
    batchId, documentId, originIssuerInstanceId: "A", originLotId: batch.originLotId,
    occurredAt: new Date(),
    verificationState: "local_verified", payloadVersion: "1.0", summary: {},
    checksumHex: "a".repeat(64) } });
  const sourceInbox = await db.inboxMessage.findFirstOrThrow({ where: { issuerInstanceId: "A" } });
  const publicId = randomUUID();
  const privateId = randomUUID();
  for (const [externalEventId, disclosureScope] of [[publicId, "public"], [privateId, "partner"]]) {
    await owner.traceEvent.create({ data: { id: randomUUID(), issuerInstanceId: "A",
      externalEventId, eventType: "trading.transfer.confirmed.v1", batchId,
      originIssuerInstanceId: "A", originLotId: batch.originLotId, occurredAt: new Date(),
      verificationState: "partner_asserted", payloadVersion: "1.0", summary: {},
      checksumHex: "b".repeat(64) } });
    await owner.federatedTraceSummary.create({ data: { id: randomUUID(),
      issuerInstanceId: "A", externalEventId, policyVersion: 1,
      disclosureScope, state: "active", sourceInboxId: sourceInbox.id,
      observedAt: new Date(), batchId } });
  }
  const transferEventId = randomUUID();
  const transferEnvelopeId = randomUUID();
  const transferLineId = randomUUID();
  const transferDocumentId = randomUUID();
  const issueDocumentId = randomUUID();
  const issueLineId = randomUUID();
  await owner.document.create({ data: { id: issueDocumentId,
    documentType: "goods_issue", documentNumber: `TEST-${randomUUID()}`,
    status: "draft", issuePurpose: "partner_transfer",
    createdBySub: "fixture", correlationId: randomUUID(),
    lines: { create: { id: issueLineId, lineNo: 1, warehouseId, batchId,
      productId: batch.productId, productVariantId: batch.productVariantId,
      uomId: uom.id, quantity: 1 } } } });
  await owner.document.update({ where: { id: issueDocumentId }, data: {
    status: "confirmed", confirmedBySub: "fixture", confirmedAt: new Date() } });
  await owner.document.create({ data: { id: transferDocumentId,
    documentType: "partner_transfer", documentNumber: `TEST-${randomUUID()}`,
    status: "draft", createdBySub: "fixture", correlationId: randomUUID(),
    lines: { create: { id: transferLineId, lineNo: 1, warehouseId, batchId,
      productId: batch.productId, productVariantId: batch.productVariantId,
      uomId: uom.id, quantity: 1, sourceIssueLineId: issueLineId } } } });
  await owner.transferDetail.create({ data: { documentId: transferDocumentId,
    linkedIssueId: issueDocumentId, destinationPartnerId: cPartnerId } });
  await owner.document.update({ where: { id: transferDocumentId }, data: {
    status: "confirmed", confirmedBySub: "fixture", confirmedAt: new Date() } });
  await owner.traceEvent.create({ data: { id: randomUUID(), issuerInstanceId: "B",
    externalEventId: transferEventId, eventType: "trading.transfer.confirmed.v1",
    batchId, documentId: transferDocumentId,
    originIssuerInstanceId: "A", originLotId: batch.originLotId,
    occurredAt: new Date(), verificationState: "local_verified", payloadVersion: "1.0",
    summary: {}, checksumHex: "c".repeat(64) } });
  await owner.outboxMessage.create({ data: { id: randomUUID(), aggregateType: "document",
    aggregateId: transferDocumentId, aggregateVersion: 1, eventType: "transfer.announced.v1",
    schemaVersion: "1", destination: "federation", correlationId: randomUUID(),
    payload: { messageId: randomUUID(), eventId: transferEnvelopeId,
      occurredAt: new Date().toISOString(), lots: [{ sourceLineId: transferLineId,
        senderBatch: { instanceId: "B", batchId }, originLot: {
          issuerInstanceId: "A", lotId: batch.originLotId } }] } } });
  const previous = process.env.NEXORA_ISSUER_INSTANCE_ID;
  process.env.NEXORA_ISSUER_INSTANCE_ID = "B";
  try {
    const admin = { userId: "fixture", organizationId: randomUUID(),
      unitIds: [], roles: ["administrator"] };
    const result = await publishTraceSummary(db, admin, batchId, "C", randomUUID());
    assert.equal(result.eventCount, 4);
    const outbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: result.messageId } });
    const payload = outbox.payload as { traceSummaries: { issuerInstanceId: string;
      externalEventId: string; disclosureScope: string }[] };
    assert.deepEqual(new Set(payload.traceSummaries.map((item) => item.externalEventId)),
      new Set([localId, publicId, transferEventId,
        `${transferEnvelopeId}:${transferLineId}`]));
    assert.equal(payload.traceSummaries.find((item) => item.externalEventId === localId)?.disclosureScope,
      "partner");
    assert.equal(JSON.stringify(payload).includes("Shared product name"), false);
  } finally { process.env.NEXORA_ISSUER_INSTANCE_ID = previous; }
});

test("forward impact maps federation EA to the local stock UOM", async () => {
  const batchId = await makeBatch("A", randomUUID());
  const batch = await db.batch.findUniqueOrThrow({ where: { id: batchId } });
  const uomId = randomUUID();
  await owner.uom.create({ data: { id: uomId, code: `CAI-${randomUUID().slice(0, 8)}`,
    name: "Cái", nameKey: randomUUID(), kind: "count" } });
  await owner.productVariantUom.create({ data: { id: randomUUID(),
    productVariantId: batch.productVariantId, uomId, factorToStockUom: 1,
    isStockKeeping: true } });
  await owner.traceEvent.create({ data: { id: randomUUID(), issuerInstanceId: "B",
    externalEventId: randomUUID(), eventType: "downstream.impact.v1", batchId,
    originIssuerInstanceId: "A", originLotId: batch.originLotId,
    occurredAt: new Date(), verificationState: "partner_asserted",
    payloadVersion: "1.0", checksumHex: "d".repeat(64), summary: {
      quantity: "2", unit: "EA", sourceLineId: randomUUID(),
      sourceDocument: { id: randomUUID() }, downstreamPartnerRef: "C" } } });
  const reader = { userId: "fixture", organizationId: "fixture", unitIds: [],
    roles: ["administrator"] };
  const graph = await forwardTrace(createPrismaForwardPort(db, reader), reader,
    { batchId, depth: 10, limit: 100 });
  assert.equal(graph.impact.length, 1);
  assert.equal(graph.impact[0]!.uomId, uomId);
  assert.equal(graph.impact[0]!.uomCode, "EA");
  assert.equal(graph.impact[0]!.partner?.issuerInstanceId, "C");
});

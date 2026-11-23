// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";
import { buildHandlerMap } from "../../composition/event-handlers";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";
import { TRADING_EVENT_TYPES, serializeDomainEvent } from "../../contracts/events/registry";
import { createPrismaTraceProjectorPort } from "../../contexts/traceability/infrastructure/projector-repos";
import { traceConsumers, traceLag } from "../../workers/trace-projector";
import { backwardTrace } from "../../contexts/traceability/application/backward";
import { createPrismaBackwardPort } from "../../contexts/traceability/infrastructure/backward-repo";
import { forwardTrace } from "../../contexts/traceability/application/forward";
import { createPrismaForwardPort } from "../../contexts/traceability/infrastructure/forward-repo";
import { createPassportService } from "../../contexts/traceability/application/passport-service";

if (process.env.NEXORA_TEST_TRACE !== "1" || !process.env.OWNER_DATABASE_URL ||
    !process.env.APP_DATABASE_URL || !process.env.CORE_DATABASE_URL) {
  throw new Error("Disposable trace database required");
}
const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });
const owner = connect(process.env.OWNER_DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
after(async () => { await Promise.all([owner.$disconnect(), app.$disconnect(), core.$disconnect()]); });
const issuer = "trace-local";
const productId = randomUUID();
const variantId = randomUUID();
const warehouseId = randomUUID();
const batches: string[] = [randomUUID(), randomUUID()];
const origins = [randomUUID(), randomUUID()];
const uom = "aaaaaaaa-0001-4000-8000-000000000001";
const sha = (value: unknown) => createHash("sha256").update(canonicalize(value)!).digest("hex");

async function receipt(batchIds: string[], occurredAt: string) {
  const documentId = randomUUID();
  await app.document.create({ data: { id: documentId, documentType: "goods_receipt",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  const lines = batchIds.map((batchId, index) => ({ id: randomUUID(), documentId,
    lineNo: index + 1, warehouseId, batchId, productVariantId: variantId,
    productId, uomId: uom, quantity: "5" }));
  await app.documentLine.createMany({ data: lines });
  const document = await app.document.update({ where: { id: documentId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const payload = { eventId: randomUUID(), documentId, documentVersion: document.version,
    lines: lines.map((line) => ({ lineId: line.id, batchId: line.batchId,
      warehouseId, originLot: { issuerInstanceId: issuer,
        lotId: origins[batches.indexOf(line.batchId)] }, quantity: "5", unit: "EA" })),
    actorSub: "fixture", occurredAt };
  const [serialized] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.receipt,
    aggregateType: "document", aggregateId: documentId, aggregateVersion: document.version,
    correlationId: randomUUID(), payload });
  const outbox = await app.outboxMessage.create({ data: { ...serialized, id: randomUUID(),
    createdAt: new Date(Date.now() - 10 * 60_000) } });
  return { documentId, payload, outbox };
}

test("P08 projector handles worker lag, multi-batch replay and deterministic rebuild", async () => {
  await owner.$executeRaw`INSERT INTO inventory.warehouse(id,code,name,status,created_by_sub)
    VALUES (${warehouseId}::uuid,${randomUUID()},'Trace projector warehouse','active','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id,name,category_id,created_by_sub)
    VALUES (${productId}::uuid,'Trace projector product','bbbbbbbb-0001-4000-8000-000000000001','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id,product_id,sku,created_by_sub)
    VALUES (${variantId}::uuid,${productId}::uuid,${randomUUID()},'fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant_uom(id,product_variant_id,uom_id,is_stock_keeping,factor_to_stock_uom)
    VALUES (${randomUUID()}::uuid,${variantId}::uuid,${uom}::uuid,true,1)`;
  for (let index = 0; index < batches.length; index++) {
    await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,
      origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
      VALUES (${batches[index]}::uuid,${productId}::uuid,${variantId}::uuid,${randomUUID()},
        ${issuer},${origins[index]},'available','fixture')`;
  }
  const later = await receipt(batches, new Date().toISOString());
  assert.equal((await app.document.findUniqueOrThrow({ where: { id: later.documentId } })).status, "confirmed");
  assert.equal(await app.traceEvent.count({ where: { documentId: later.documentId } }), 0);
  const lag = await traceLag(app);
  assert.equal(lag.pending, 1);
  assert.ok(lag.seconds > 300);
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  assert.equal((await dispatcher.tick()).delivered, 1);
  assert.equal(await app.traceEvent.count({ where: { documentId: later.documentId } }), 2);
  for (const batchId of batches) {
    const row = await core.coreRecord.findUniqueOrThrow({ where: { kind_sourceType_sourceId: {
      kind: "trace_projection", sourceType: "lot", sourceId: batchId } } });
    assert.equal(row.version, 1);
    assert.equal(row.visibility, "private");
    assert.equal(row.checksumHex, sha(row.payload));
    assert.equal((row.payload as { sourceEventIds: string[] }).sourceEventIds.length, 1);
  }
  await app.outboxMessage.update({ where: { id: later.outbox.id }, data: {
    status: "retry_due", nextAttemptAt: new Date(Date.now() - 1000), deliveredAt: null } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  assert.equal(await app.traceEvent.count({ where: { documentId: later.documentId } }), 2);
  assert.equal((await core.coreRecord.findUniqueOrThrow({ where: { kind_sourceType_sourceId: {
    kind: "trace_projection", sourceType: "lot", sourceId: batches[0] } } })).version, 1);

  const earlier = await receipt([batches[0]], new Date(Date.now() - 60 * 60_000).toISOString());
  assert.equal((await dispatcher.tick()).delivered, 1);
  const record = await core.coreRecord.findUniqueOrThrow({ where: { kind_sourceType_sourceId: {
    kind: "trace_projection", sourceType: "lot", sourceId: batches[0] } } });
  const snapshot = record.payload as { sourceEventIds: string[]; nodes: { occurredAt: string }[] };
  assert.equal(snapshot.sourceEventIds.length, 2);
  assert.ok(snapshot.nodes[0].occurredAt < snapshot.nodes[1].occurredAt);
  const before = record.checksumHex;
  const projector = createPrismaTraceProjectorPort(app, core, issuer);
  await Promise.all([projector.rebuild(batches[0]), projector.rebuild(batches[0])]);
  const rebuilt = await core.coreRecord.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(rebuilt.checksumHex, before);
  assert.equal(rebuilt.version, record.version);
  assert.equal((await traceLag(app)).pending, 0);
  assert.equal((await app.outboxMessage.findUniqueOrThrow({ where: { id: earlier.outbox.id } })).status,
    "delivered");
});

test("P08 transfer waits for its confirmed issue source, then links and replays once", async () => {
  const issueId = randomUUID();
  const issueLineId = randomUUID();
  const transferId = randomUUID();
  const partnerId = randomUUID();
  await app.partner.create({ data: { id: partnerId, issuerInstanceId: "trace-remote",
    code: randomUUID(), displayName: "Trace remote", createdBySub: "fixture" } });
  await app.document.create({ data: { id: issueId, documentType: "goods_issue",
    issuePurpose: "partner_transfer", documentNumber: randomUUID(), status: "draft",
    createdBySub: "fixture", correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: issueLineId, documentId: issueId, lineNo: 1,
    warehouseId, batchId: batches[0], productVariantId: variantId, productId,
    uomId: uom, quantity: "2" } });
  const issue = await app.document.update({ where: { id: issueId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  await app.document.create({ data: { id: transferId, documentType: "partner_transfer",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: transferId, lineNo: 1,
    warehouseId, batchId: batches[0], productVariantId: variantId, productId,
    uomId: uom, quantity: "2", sourceIssueLineId: issueLineId } });
  await app.transferDetail.create({ data: { documentId: transferId, linkedIssueId: issueId,
    destinationPartnerId: partnerId } });
  const transfer = await app.document.update({ where: { id: transferId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const occurredAt = new Date().toISOString();
  const originLot = { issuerInstanceId: issuer, lotId: origins[0] };
  const [transferMessage] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.transfer,
    aggregateType: "document", aggregateId: transferId, aggregateVersion: transfer.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), transferId,
      linkedIssueId: issueId, destinationPartnerId: partnerId,
      lines: [{ sourceLineId: issueLineId, batchId: batches[0], originLot,
        quantity: "2", unit: "EA" }], occurredAt } });
  const pending = await app.outboxMessage.create({ data: { ...transferMessage, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  assert.equal((await dispatcher.tick()).retried, 1);
  assert.equal(await app.traceEvent.count({ where: { documentId: transferId } }), 0);

  const [issueMessage] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.issue,
    aggregateType: "document", aggregateId: issueId, aggregateVersion: issue.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), documentId: issueId,
      documentVersion: issue.version, lines: [{ lineId: issueLineId, batchId: batches[0],
        warehouseId, originLot, quantity: "2", unit: "EA" }], movementIds: [randomUUID()],
      actorSub: "fixture", occurredAt } });
  await app.outboxMessage.create({ data: { ...issueMessage, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  await app.outboxMessage.update({ where: { id: pending.id }, data: {
    nextAttemptAt: new Date(Date.now() - 1000) } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const issueEvent = await app.traceEvent.findFirstOrThrow({ where: { documentId: issueId } });
  const transferEvent = await app.traceEvent.findFirstOrThrow({ where: { documentId: transferId } });
  assert.equal((await app.traceLink.findFirstOrThrow({ where: { fromEventId: transferEvent.id } })).toEventId,
    issueEvent.id);
  await app.outboxMessage.update({ where: { id: pending.id }, data: {
    status: "retry_due", nextAttemptAt: new Date(Date.now() - 1000), deliveredAt: null } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  assert.equal(await app.traceLink.count({ where: { fromEventId: transferEvent.id } }), 1);
});

test("P08 receiving keeps a verified local source and an explicit remote gap", async () => {
  const receivingId = randomUUID();
  const remoteTransferId = randomUUID();
  const remoteEventId = randomUUID();
  const sourceLineId = randomUUID();
  const messageId = randomUUID();
  const inbound = { eventId: remoteEventId, issuerInstanceId: "trace-remote",
    sourceDocument: { id: remoteTransferId } };
  await app.inboundMessage.create({ data: { messageId, eventType: "transfer.announced.v1",
    issuerInstanceId: "trace-remote", recipientInstanceId: issuer,
    payload: inbound, payloadHash: sha(inbound) } });
  await app.document.create({ data: { id: receivingId, documentType: "receiving_confirmation",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: receivingId,
    lineNo: 1, warehouseId, batchId: batches[1], productVariantId: variantId,
    productId, uomId: uom, quantity: "2", actualQuantity: "1", sourceLineRef: sourceLineId } });
  await app.receivingDetail.create({ data: { documentId: receivingId,
    sourceIssuerInstanceId: "trace-remote", sourceTransferId: remoteTransferId,
    inboundMessageId: messageId, sentQuantity: "2", actualQuantity: "1",
    discrepancyReason: "one unit missing" } });
  const receiving = await app.document.update({ where: { id: receivingId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const [serialized] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.receiving,
    aggregateType: "document", aggregateId: receivingId, aggregateVersion: receiving.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), receivingId,
      sourceIssuerInstanceId: "trace-remote", sourceTransferId: remoteTransferId,
      sentLines: [{ sourceLineId, originLot: { issuerInstanceId: issuer, lotId: origins[1] },
        sentQuantity: "2", unit: "EA" }],
      actualLines: [{ sourceLineId, localBatchId: batches[1], actualQuantity: "1", unit: "EA" }],
      discrepancyReason: "one unit missing", occurredAt: new Date().toISOString() } });
  await app.outboxMessage.create({ data: { ...serialized, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const event = await app.traceEvent.findFirstOrThrow({ where: { documentId: receivingId } });
  assert.equal(event.verificationState, "local_verified");
  const link = await app.traceLink.findFirstOrThrow({ where: { fromEventId: event.id } });
  assert.equal(link.verificationState, "missing");
  assert.deepEqual(link.missingRef, { issuerInstanceId: "trace-remote", eventId: remoteEventId });
  const row = await core.coreRecord.findUniqueOrThrow({ where: { kind_sourceType_sourceId: {
    kind: "trace_projection", sourceType: "lot", sourceId: batches[1] } } });
  const edges = (row.payload as { edges: { missingRef?: unknown }[] }).edges;
  assert.ok(edges.some((edge) => JSON.stringify(edge.missingRef) === JSON.stringify(link.missingRef)));
});

test("P08 sale and stocktake project from confirmed document sources", async () => {
  const issueId = randomUUID();
  const issueLineId = randomUUID();
  const saleId = randomUUID();
  const stocktakeId = randomUUID();
  await app.document.create({ data: { id: issueId, documentType: "goods_issue",
    issuePurpose: "sale", documentNumber: randomUUID(), status: "draft",
    createdBySub: "fixture", correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: issueLineId, documentId: issueId,
    lineNo: 1, warehouseId, batchId: batches[0], productVariantId: variantId,
    productId, uomId: uom, quantity: "1" } });
  const issue = await app.document.update({ where: { id: issueId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  await app.document.create({ data: { id: saleId, documentType: "sale_record",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: saleId,
    lineNo: 1, warehouseId, batchId: batches[0], productVariantId: variantId,
    productId, uomId: uom, quantity: "1", sourceIssueLineId: issueLineId } });
  await app.saleDetail.create({ data: { documentId: saleId, linkedIssueId: issueId,
    soldAt: new Date(), buyerRef: "PRIVATE_BUYER_REF" } });
  const sale = await app.document.update({ where: { id: saleId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  await app.document.create({ data: { id: stocktakeId, documentType: "stocktake",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  const stockLineId = randomUUID();
  await app.documentLine.create({ data: { id: stockLineId, documentId: stocktakeId,
    lineNo: 1, warehouseId, batchId: batches[0], productVariantId: variantId,
    productId, uomId: uom, countedQuantity: "4" } });
  const stock = await app.document.update({ where: { id: stocktakeId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const originLot = { issuerInstanceId: issuer, lotId: origins[0] };
  const emitted = [
    serializeDomainEvent({ type: TRADING_EVENT_TYPES.issue, aggregateType: "document",
      aggregateId: issueId, aggregateVersion: issue.version, correlationId: randomUUID(),
      payload: { eventId: randomUUID(), documentId: issueId, documentVersion: issue.version,
        lines: [{ lineId: issueLineId, batchId: batches[0], warehouseId, originLot,
          quantity: "1", unit: "EA" }], movementIds: [randomUUID()],
        actorSub: "fixture", occurredAt: new Date().toISOString() } })[0],
    serializeDomainEvent({ type: TRADING_EVENT_TYPES.sale, aggregateType: "document",
      aggregateId: saleId, aggregateVersion: sale.version, correlationId: randomUUID(),
      payload: { eventId: randomUUID(), saleId, linkedIssueId: issueId,
        lines: [{ sourceLineId: issueLineId, batchId: batches[0], originLot,
          quantity: "1", unit: "EA" }], occurredAt: new Date().toISOString() } })[0],
    serializeDomainEvent({ type: TRADING_EVENT_TYPES.stocktake, aggregateType: "document",
      aggregateId: stocktakeId, aggregateVersion: stock.version, correlationId: randomUUID(),
      payload: { eventId: randomUUID(), documentId: stocktakeId, documentVersion: stock.version,
        lines: [{ lineId: stockLineId, batchId: batches[0], warehouseId,
          systemQuantity: "5", countedQuantity: "4", delta: "-1", unit: "EA" }],
        actorSub: "fixture", reason: "counted", occurredAt: new Date().toISOString() } })[0],
  ];
  for (const event of emitted) await app.outboxMessage.create({ data: { ...event, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  const first = await dispatcher.tick();
  assert.equal(first.delivered + first.retried, 3);
  if (first.retried) {
    await app.outboxMessage.updateMany({ where: { status: "retry_due", eventType: TRADING_EVENT_TYPES.sale },
      data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.equal((await dispatcher.tick()).delivered, first.retried);
  }
  const saleEvent = await app.traceEvent.findFirstOrThrow({ where: { documentId: saleId } });
  const source = await app.traceEvent.findFirstOrThrow({ where: { documentId: issueId } });
  assert.equal((await app.traceLink.findFirstOrThrow({ where: { fromEventId: saleEvent.id } })).toEventId,
    source.id);
  assert.equal((await app.traceEvent.findFirstOrThrow({ where: { documentId: stocktakeId } })).eventType,
    TRADING_EVENT_TYPES.stocktake);
});

test("P08-T03 backward query keeps source links, remote gap and pages distinct", async () => {
  const actor = { userId: "fixture", organizationId: "fixture", unitIds: [warehouseId], roles: ["viewer"] };
  const port = createPrismaBackwardPort(app, actor);
  const transfer = await app.traceEvent.findFirstOrThrow({ where: {
    batchId: batches[0], eventType: TRADING_EVENT_TYPES.transfer } });
  const focused = await backwardTrace(port, actor, { batchId: batches[0],
    documentId: transfer.documentId!, depth: 2 });
  assert.equal(focused.nodes.length, 2);
  assert.equal(focused.edges.length, 1);
  assert.equal(focused.edges[0].toEventId, focused.nodes[1].eventId);
  assert.equal(focused.nodes[0].source.documentId, transfer.documentId);
  assert.equal(focused.nodes.some((node) => node.eventType === TRADING_EVENT_TYPES.receipt), false);
  const first = await backwardTrace(port, actor, { batchId: batches[0], limit: 2 });
  assert.equal(first.nodes.length, 2);
  assert.ok(first.nextCursor);
  const second = await backwardTrace(port, actor, { batchId: batches[0],
    limit: 2, cursor: first.nextCursor });
  assert.equal(second.asOf, first.asOf);
  assert.equal(first.nodes.some((node) => second.nodes.some((other) =>
    other.eventId === node.eventId)), false);
  const remote = await backwardTrace(port, actor, { batchId: batches[1] });
  assert.ok(remote.gaps.some((gap) => gap.reason === "remote_source_unavailable" &&
    gap.missingRef?.issuerInstanceId === "trace-remote"));
  assert.equal(remote.nodes.some((node) => node.issuerInstanceId === "trace-remote"), false);
});

test("P08-T04 forward impact keeps two transfer branches, partial receiving and sale private", async () => {
  const secondPartnerId = randomUUID();
  const issueId = randomUUID();
  const issueLineId = randomUUID();
  const transferId = randomUUID();
  await app.partner.create({ data: { id: secondPartnerId, issuerInstanceId: "trace-remote-2",
    code: randomUUID(), displayName: "Second downstream", createdBySub: "fixture" } });
  await app.document.create({ data: { id: issueId, documentType: "goods_issue",
    issuePurpose: "partner_transfer", documentNumber: randomUUID(), status: "draft",
    createdBySub: "fixture", correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: issueLineId, documentId: issueId,
    lineNo: 1, warehouseId, batchId: batches[0], productVariantId: variantId,
    productId, uomId: uom, quantity: "3" } });
  const issue = await app.document.update({ where: { id: issueId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  await app.document.create({ data: { id: transferId, documentType: "partner_transfer",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: transferId,
    lineNo: 1, warehouseId, batchId: batches[0], productVariantId: variantId,
    productId, uomId: uom, quantity: "3", sourceIssueLineId: issueLineId } });
  await app.transferDetail.create({ data: { documentId: transferId, linkedIssueId: issueId,
    destinationPartnerId: secondPartnerId } });
  const transfer = await app.document.update({ where: { id: transferId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const originLot = { issuerInstanceId: issuer, lotId: origins[0] };
  const [issueEvent] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.issue,
    aggregateType: "document", aggregateId: issueId, aggregateVersion: issue.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), documentId: issueId,
      documentVersion: issue.version, lines: [{ lineId: issueLineId, batchId: batches[0],
        warehouseId, originLot, quantity: "3", unit: "EA" }], movementIds: [randomUUID()],
      actorSub: "fixture", occurredAt: new Date().toISOString() } });
  await app.outboxMessage.create({ data: { ...issueEvent, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const [transferEvent] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.transfer,
    aggregateType: "document", aggregateId: transferId, aggregateVersion: transfer.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), transferId,
      linkedIssueId: issueId, destinationPartnerId: secondPartnerId,
      lines: [{ sourceLineId: issueLineId, batchId: batches[0], originLot,
        quantity: "3", unit: "EA" }], occurredAt: new Date().toISOString() } });
  await app.outboxMessage.create({ data: { ...transferEvent, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  assert.equal((await dispatcher.tick()).delivered, 1);

  const actor = { userId: "fixture", organizationId: "fixture", unitIds: [warehouseId], roles: ["viewer"] };
  const graph = await forwardTrace(createPrismaForwardPort(app, actor), actor,
    { batchId: batches[0], depth: 10, limit: 100 });
  const transfers = graph.impact.filter((row) => row.kind === "transfer");
  assert.equal(transfers.length, 2);
  assert.deepEqual(new Set(transfers.map((row) => row.quantity)), new Set(["2", "3"]));
  assert.deepEqual(new Set(transfers.map((row) => row.partner?.issuerInstanceId)),
    new Set(["trace-remote", "trace-remote-2"]));
  assert.equal(graph.gaps.filter((gap) => gap.reason === "downstream_unreported").length, 2);
  assert.ok(graph.impact.some((row) => row.kind === "sale" && row.quantity === "1"));
  assert.equal(JSON.stringify(graph).includes("PRIVATE_BUYER_REF"), false);
  const receiving = await forwardTrace(createPrismaForwardPort(app, actor), actor,
    { batchId: batches[1], depth: 10 });
  assert.ok(receiving.impact.some((row) => row.kind === "receiving" &&
    row.sentQuantity === "2" && row.actualQuantity === "1" && row.quantity === "1"));
  assert.equal(receiving.impact.some((row) => row.kind === "transfer"), false);
  const cIssueId = randomUUID();
  const cIssueLineId = randomUUID();
  const cSaleId = randomUUID();
  await app.document.create({ data: { id: cIssueId, documentType: "goods_issue",
    issuePurpose: "sale", documentNumber: randomUUID(), status: "draft",
    createdBySub: "fixture", correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: cIssueLineId, documentId: cIssueId,
    lineNo: 1, warehouseId, batchId: batches[1], productVariantId: variantId,
    productId, uomId: uom, quantity: "1" } });
  const cIssue = await app.document.update({ where: { id: cIssueId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  await app.document.create({ data: { id: cSaleId, documentType: "sale_record",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: cSaleId,
    lineNo: 1, warehouseId, batchId: batches[1], productVariantId: variantId,
    productId, uomId: uom, quantity: "1", sourceIssueLineId: cIssueLineId } });
  await app.saleDetail.create({ data: { documentId: cSaleId, linkedIssueId: cIssueId,
    soldAt: new Date(), buyerRef: "PRIVATE_C_BUYER" } });
  const cSale = await app.document.update({ where: { id: cSaleId }, data: {
    status: "confirmed", confirmedAt: new Date(), confirmedBySub: "fixture" } });
  const cOriginLot = { issuerInstanceId: issuer, lotId: origins[1] };
  const [cIssueEvent] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.issue,
    aggregateType: "document", aggregateId: cIssueId, aggregateVersion: cIssue.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), documentId: cIssueId,
      documentVersion: cIssue.version, lines: [{ lineId: cIssueLineId,
        batchId: batches[1], warehouseId, originLot: cOriginLot, quantity: "1", unit: "EA" }],
      movementIds: [randomUUID()], actorSub: "fixture", occurredAt: new Date().toISOString() } });
  await app.outboxMessage.create({ data: { ...cIssueEvent, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const [cSaleEvent] = serializeDomainEvent({ type: TRADING_EVENT_TYPES.sale,
    aggregateType: "document", aggregateId: cSaleId, aggregateVersion: cSale.version,
    correlationId: randomUUID(), payload: { eventId: randomUUID(), saleId: cSaleId,
      linkedIssueId: cIssueId, lines: [{ sourceLineId: cIssueLineId,
        batchId: batches[1], originLot: cOriginLot, quantity: "1", unit: "EA" }],
      occurredAt: new Date().toISOString() } });
  await app.outboxMessage.create({ data: { ...cSaleEvent, id: randomUUID(),
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const cGraph = await forwardTrace(createPrismaForwardPort(app, actor), actor,
    { batchId: batches[1], depth: 10 });
  assert.ok(cGraph.impact.some((row) => row.kind === "sale" && row.quantity === "1" &&
    row.sourceDocumentId === cSaleId));
  assert.equal(JSON.stringify(cGraph).includes("PRIVATE_C_BUYER"), false);
  const cIssueImpact = cGraph.impact.find((row) => row.sourceDocumentId === cIssueId);
  const cReceivingImpact = cGraph.impact.find((row) => row.kind === "receiving");
  assert.ok(cIssueImpact && cReceivingImpact);
  assert.equal(cGraph.edges.some((edge) => edge.fromEventId === cReceivingImpact.eventId &&
    edge.toEventId === cIssueImpact.eventId), false);
  const deniedActor = { ...actor, unitIds: [randomUUID()] };
  const denied = await forwardTrace(createPrismaForwardPort(app, deniedActor), deniedActor,
    { batchId: batches[0] });
  assert.equal(denied.nodes.length, 0);
  assert.equal(denied.impact.length, 0);
  const backwardDenied = await backwardTrace(createPrismaBackwardPort(app, deniedActor), deniedActor,
    { batchId: batches[0] });
  assert.equal(backwardDenied.nodes.length, 0);
});

test("P08-T05 owner approval builds only allowlisted public data and invalidates on source or quality change", async () => {
  const admin = { userId: "fixture-owner", organizationId: "fixture",
    unitIds: [], roles: ["administrator"] };
  const viewer = { ...admin, roles: ["viewer"] };
  const service = createPassportService(app);
  const privateAccess = { organization: "private", product: "private", batch: "private",
    timeline: "private", evidence: "private" };
  await assert.rejects(service.createDraft(viewer, batches[0], privateAccess, randomUUID()),
    { code: "POLICY_DENIED" });
  const draft = await service.createDraft(admin, batches[0], privateAccess, randomUUID());
  assert.equal(draft.state, "draft");
  assert.equal(draft.policyVersion, 1);
  assert.equal((await service.approve(admin, batches[0], 1, randomUUID())).projectionState,
    "revoked");
  const publicAccess = { organization: "public", product: "public", batch: "public",
    timeline: "public", evidence: "private" };
  const second = await service.createDraft(admin, batches[0], publicAccess, randomUUID());
  assert.equal(second.policyVersion, 2);
  assert.equal((await service.approve(admin, batches[0], 2, randomUUID())).projectionState,
    "active");
  const firstProjection = await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } });
  assert.deepEqual(Object.keys(firstProjection.publicPayload as object).sort(), ["productName",
    "publicLotCode", "originIssuer", "timeline", "verificationState", "gaps", "asOf"].sort());
  assert.equal(firstProjection.policyVersion, "v2");
  assert.equal(JSON.stringify(firstProjection.publicPayload).includes("PRIVATE_BUYER_REF"), false);
  assert.equal(JSON.stringify(firstProjection.publicPayload).includes("PRIVATE_C_BUYER"), false);
  assert.ok(firstProjection.sourceEventIds.length > 0);
  assert.equal(await app.passportPolicy.count({ where: { batchId: batches[0],
    state: "approved" } }), 1);

  const newSource = await receipt([batches[0]], new Date().toISOString());
  assert.equal((await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).state, "stale");
  assert.equal((await service.rebuild(admin, batches[0], randomUUID())).state, "stale");
  const pendingPayload = (await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).publicPayload;
  assert.ok(JSON.stringify(pendingPayload).includes("projection_pending"));
  await app.outboxMessage.update({ where: { id: newSource.outbox.id }, data: {
    nextAttemptAt: new Date(Date.now() - 60_000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-test-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, issuer) }) });
  assert.equal((await dispatcher.tick()).delivered, 1);
  assert.equal((await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).state, "stale");
  assert.equal((await service.rebuild(admin, batches[0], randomUUID())).state, "active");
  assert.notEqual((await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).checksumHex, firstProjection.checksumHex);

  await app.batch.update({ where: { id: batches[0] }, data: { qualityStatus: "restricted" } });
  assert.equal((await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).state, "revoked");
  assert.equal((await service.rebuild(admin, batches[0], randomUUID())).state, "revoked");
  await app.batch.update({ where: { id: batches[0] }, data: { qualityStatus: "available" } });
  assert.equal((await service.rebuild(admin, batches[0], randomUUID())).state, "active");
  await service.revoke(admin, batches[0], "owner decision", randomUUID());
  assert.equal((await app.passportProjection.findUniqueOrThrow({ where: {
    batchId: batches[0] } })).state, "revoked");
  await assert.rejects(service.rebuild(admin, batches[0], randomUUID()),
    { code: "PASSPORT_POLICY_NOT_ACTIVE" });
  assert.ok(await app.auditLog.count({ where: { targetType: "passport_policy" } }) >= 6);
  const revokeAudit = await app.auditLog.findFirstOrThrow({ where: {
    action: "passport.policy.revoke", targetType: "passport_policy" } });
  assert.equal((revokeAudit.afterSummary as { status: string }).status, "revoked");
});

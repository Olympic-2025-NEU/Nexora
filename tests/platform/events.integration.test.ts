// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildHandlerMap, createRoutingHandler, type EventConsumer } from "../../composition/event-handlers";
import { EVENT_DESTINATIONS, TRADING_EVENT_TYPES, serializeDomainEvent } from "../../contracts/events/registry";
import fixtures from "../../contracts/events/fixtures/domain-events-v1.json";
import { runCommand, type CommandOptions } from "../../platform/http/pipeline";
import { retryDeadLetter } from "../../platform/outbox/admin";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";
import type { OutboxEventInput, OutboxMessage } from "../../platform/outbox/message";
import { appendOutbox } from "../../platform/outbox/writer";
import { createTransaction } from "../../platform/persistence/transaction";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.APP_DATABASE_URL) throw Error("Isolated DB required");
const client = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
after(async () => client.$disconnect());
afterEach(async () => {
  await client.outboxMessage.updateMany({ where: { status: { in: ["pending", "retry_due", "leased"] } },
    data: { status: "delivered", leaseOwner: null, leaseUntil: null } });
});
const receipt = fixtures.cases["trading-receipt-confirmed-v1.schema.json"];
const transfer = fixtures.cases["trading-transfer-confirmed-v1.schema.json"];
const payload = (documentId: string, documentVersion: number) =>
  ({ ...receipt.valid, documentId, documentVersion, eventId: randomUUID() });
const event = (type: typeof TRADING_EVENT_TYPES.receipt | typeof TRADING_EVENT_TYPES.transfer,
  aggregateId = randomUUID(), aggregateVersion = 1, eventPayload: OutboxEventInput["payload"] =
    type === TRADING_EVENT_TYPES.receipt ? payload(aggregateId, aggregateVersion) : transfer.valid,
  destinations?: (typeof EVENT_DESTINATIONS)[keyof typeof EVENT_DESTINATIONS][]) =>
  serializeDomainEvent({ type, payload: eventPayload, aggregateType: "trading", aggregateId,
    aggregateVersion, correlationId: randomUUID(), destinations });
const enqueue = async (...events: OutboxEventInput[]) => client.$transaction((tx) => appendOutbox(tx, events));
const rows = (id: string) => client.outboxMessage.findMany({ where: { aggregateId: id }, orderBy: { destination: "asc" } });
const dispatch = (handlers = buildHandlerMap(), maxAttempts = 8) =>
  createOutboxDispatcher({ client, handlers, maxAttempts, workerId: randomUUID() });

function command(domain: CommandOptions<{ id: string }>["domain"]) {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => ({ userId: "events-user", organizationId: "test-org", unitIds: [], roles: ["staff"] }),
    resolveTenant: async () => "test-org", action: "trading:goods-issue:create",
    unitOfWork: () => createTransaction(client), domain,
  });
}

test("confirm emits one receipt row with source ID; transfer fan-out shares eventId", async () => {
  const source = randomUUID();
  await command(async (ctx) => {
    await ctx.tx.auditLog.create({ data: { id: randomUUID(), actorSub: "events-user", action: "events.confirm",
      targetType: "trading", targetId: source, outcome: "success", requestId: ctx.requestId } });
    for (const input of event(TRADING_EVENT_TYPES.receipt, source, 2)) ctx.emit(input);
    return { id: source };
  });
  const confirmed = await rows(source);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].eventType, TRADING_EVENT_TYPES.receipt);
  assert.equal(confirmed[0].schemaVersion, "1");
  assert.equal(confirmed[0].destination, EVENT_DESTINATIONS.traceability);
  assert.equal((confirmed[0].payload as typeof receipt.valid).documentId, source);
  assert.ok((confirmed[0].payload as typeof receipt.valid).eventId);
  assert.equal(await client.auditLog.count({ where: { targetId: source } }), 1);

  const id = randomUUID();
  await command(async (ctx) => {
    for (const input of event(TRADING_EVENT_TYPES.transfer, id, 1)) ctx.emit(input);
    return { id };
  });
  const copies = await rows(id);
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map((copy) => copy.destination), [EVENT_DESTINATIONS.federation, EVENT_DESTINATIONS.traceability]);
  assert.notEqual(copies[0].id, copies[1].id);
  assert.equal((copies[0].payload as typeof transfer.valid).eventId, (copies[1].payload as typeof transfer.valid).eventId);
});

test("Draft/no-emit, rollback after emit and invalid emit leave zero outbox rows", async () => {
  const draft = randomUUID(), rollback = randomUUID(), invalid = randomUUID();
  await command(async () => ({ id: draft }));
  assert.equal((await rows(draft)).length, 0);
  await assert.rejects(command(async (ctx) => {
    for (const input of event(TRADING_EVENT_TYPES.receipt, rollback)) ctx.emit(input);
    throw Error("rollback");
  }), /rollback/);
  assert.equal((await rows(rollback)).length, 0);
  await assert.rejects(command(async (ctx) => {
    await ctx.tx.auditLog.create({ data: { id: randomUUID(), actorSub: "events-user", action: "events.invalid",
      targetType: "trading", targetId: invalid, outcome: "success", requestId: ctx.requestId } });
    for (const input of event(TRADING_EVENT_TYPES.receipt, invalid, 1, receipt.invalid)) ctx.emit(input);
    return { id: invalid };
  }), /INVALID_EVENT_PAYLOAD/);
  assert.equal((await rows(invalid)).length, 0);
  assert.equal(await client.auditLog.count({ where: { targetId: invalid } }), 0);
});

test("unknown version, invalid payload and unknown type fast dead-letter; successor passes ordering gate", async () => {
  const id = randomUUID();
  const version2 = { ...event(TRADING_EVENT_TYPES.receipt, id, 1)[0],
    eventType: "trading.receipt.confirmed.v2", schemaVersion: "2" };
  const successor = event(TRADING_EVENT_TYPES.receipt, id, 2)[0];
  await enqueue(version2, successor);
  assert.equal((await dispatch().tick()).deadLettered, 1);
  const first = (await rows(id)).find((row) => row.aggregateVersion === 1)!;
  assert.equal(first.status, "dead_letter");
  assert.equal(first.attemptCount, 1);
  assert.equal(first.lastErrorCode, "UNSUPPORTED_EVENT_VERSION");
  assert.equal((await dispatch().stats()).deadLetter >= 1, true);
  assert.equal((await dispatch().tick()).deadLettered, 1);
  const next = (await rows(id)).find((row) => row.aggregateVersion === 2)!;
  assert.equal(next.status, "dead_letter");
  assert.equal(next.attemptCount, 1);
  assert.equal(next.lastErrorCode, "NO_CONSUMER_REGISTERED");
  assert.deepEqual([...buildHandlerMap().keys()], [EVENT_DESTINATIONS.traceability, EVENT_DESTINATIONS.federation]);
  assert.equal(await retryDeadLetter(client, next.id), true);
  let replayed = 0;
  assert.equal((await dispatch(buildHandlerMap({ traceability: new Map([[TRADING_EVENT_TYPES.receipt,
    async () => { replayed++; }]]) })).tick()).delivered, 1);
  assert.equal(replayed, 1);
  assert.equal((await rows(id)).find((row) => row.aggregateVersion === 2)!.status, "delivered");

  for (const [type, badPayload, reason] of [
    [TRADING_EVENT_TYPES.receipt, receipt.invalid, "INVALID_EVENT_PAYLOAD"],
    ["trading.unknown.v1", receipt.valid, "UNSUPPORTED_EVENT_TYPE"],
  ] as const) {
    const other = randomUUID();
    await enqueue({ ...event(TRADING_EVENT_TYPES.receipt, other)[0], eventType: type, payload: badPayload });
    assert.equal((await dispatch().tick()).deadLettered, 1);
    const failed = (await rows(other))[0];
    assert.equal(failed.status, "dead_letter");
    assert.equal(failed.attemptCount, 1);
    assert.equal(failed.lastErrorCode, reason);
  }
});

test("destination/type routing isolation; transient failure retries only failing copy", async () => {
  const calls: string[] = [];
  const handlers = buildHandlerMap({
    traceability: new Map([
      [TRADING_EVENT_TYPES.transfer, async (message) => { calls.push(`trace:${message.eventType}`); }],
      [TRADING_EVENT_TYPES.receipt, async (message) => { calls.push(`receipt:${message.eventType}`); }],
    ]),
    federation: new Map([[TRADING_EVENT_TYPES.transfer, async (message) => {
      calls.push(`federation:${message.eventType}`);
      throw Error("offline");
    }]]),
  });
  const id = randomUUID(), receiptId = randomUUID();
  await enqueue(...event(TRADING_EVENT_TYPES.transfer, id), ...event(TRADING_EVENT_TYPES.receipt, receiptId));
  const first = await dispatch(handlers, 2).tick();
  assert.equal(first.delivered, 2);
  assert.equal(first.retried, 1);
  assert.deepEqual(calls.sort(), [
    `federation:${TRADING_EVENT_TYPES.transfer}`, `receipt:${TRADING_EVENT_TYPES.receipt}`,
    `trace:${TRADING_EVENT_TYPES.transfer}`,
  ].sort());
  const copy = (await rows(id)).find((row) => row.destination === EVENT_DESTINATIONS.federation)!;
  assert.equal(copy.status, "retry_due");
  await client.$executeRaw`UPDATE platform.outbox_message SET next_attempt_at = now() - interval '1 second'
    WHERE id = ${copy.id}::uuid`;
  assert.equal((await dispatch(handlers, 2).tick()).deadLettered, 1);
  assert.equal((await rows(id)).find((row) => row.destination === EVENT_DESTINATIONS.federation)!.attemptCount, 2);
  assert.equal((await rows(id)).find((row) => row.destination === EVENT_DESTINATIONS.traceability)!.status, "delivered");
});

test("reference consumer dedupes eventId/natural key and guards replayed versions and gaps", async () => {
  const gaps: number[] = [];
  const consumer: EventConsumer = async (message) => {
    const data = message.payload as typeof receipt.valid;
    await client.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ document_version: number }[]>`
        SELECT document_version FROM platform.event_test_projection WHERE document_id = ${data.documentId}::uuid`;
      if (data.documentVersion > (current[0]?.document_version ?? 0) + 1) gaps.push(data.documentVersion);
      await tx.$executeRaw`INSERT INTO platform.event_test_effect (event_id, document_id, document_version)
        VALUES (${data.eventId}::uuid, ${data.documentId}::uuid, ${data.documentVersion}) ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`INSERT INTO platform.event_test_projection (document_id, document_version)
        VALUES (${data.documentId}::uuid, ${data.documentVersion})
        ON CONFLICT (document_id) DO UPDATE SET document_version = EXCLUDED.document_version
        WHERE platform.event_test_projection.document_version < EXCLUDED.document_version`;
    });
  };
  const handler = createRoutingHandler(EVENT_DESTINATIONS.traceability,
    new Map([[TRADING_EVENT_TYPES.receipt, consumer]]));
  const id = randomUUID();
  await enqueue(event(TRADING_EVENT_TYPES.receipt, id, 1)[0]);
  const message = (await rows(id))[0] as OutboxMessage;
  await handler(message); await handler(message); // Crash after effect, before delivered marking.
  assert.equal((await client.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM platform.event_test_effect WHERE document_id = ${id}::uuid`)[0].count, BigInt(1));
  await enqueue(event(TRADING_EVENT_TYPES.receipt, id, 3)[0], event(TRADING_EVENT_TYPES.receipt, id, 2)[0]);
  const remaining = await rows(id);
  await handler(remaining.find((row) => row.aggregateVersion === 3)! as OutboxMessage);
  await handler(remaining.find((row) => row.aggregateVersion === 2)! as OutboxMessage);
  assert.deepEqual(gaps, [3]);
  assert.equal((await client.$queryRaw<{ document_version: number }[]>`
    SELECT document_version FROM platform.event_test_projection WHERE document_id = ${id}::uuid`)[0].document_version, 3);

  const other = randomUUID();
  await enqueue(event(TRADING_EVENT_TYPES.receipt, other, 2)[0]); // v1 dead-lettered; v2 proceeds.
  await handler((await rows(other))[0] as OutboxMessage);
  assert.deepEqual(gaps, [3, 2]);
});

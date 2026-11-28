// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";
import { retryDeadLetter } from "../../platform/outbox/admin";
import { appendOutbox } from "../../platform/outbox/writer";
import { PermanentDeliveryError, type OutboxEventInput, type OutboxHandler } from "../../platform/outbox/message";
import { createPrismaIdempotency } from "../../platform/http/idempotency";
import { runCommand, type CommandOptions } from "../../platform/http/pipeline";
import { createTransaction } from "../../platform/persistence/transaction";
import { createFederationOutboundHandler } from "../../workers/federation-outbound";
import { readFileSync } from "node:fs";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.APP_DATABASE_URL) throw Error("Isolated DB required");
const client = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
after(async () => client.$disconnect());
afterEach(async () => {
  await client.outboxMessage.updateMany({ where: { status: { in: ["pending", "retry_due", "leased"] } },
    data: { status: "delivered", leaseOwner: null, leaseUntil: null } });
});
const event = (aggregateId = randomUUID(), aggregateVersion = 1): OutboxEventInput => ({
  aggregateType: "test", aggregateId, aggregateVersion, eventType: "test.created.v1",
  schemaVersion: "1", payload: { eventId: randomUUID() }, destination: "local", correlationId: randomUUID(),
});
const enqueue = async (...events: OutboxEventInput[]) => client.$transaction((tx) => appendOutbox(tx, events));
const row = (aggregateId: string) => client.outboxMessage.findFirstOrThrow({ where: { aggregateId } });
const due = async (id: string) => client.$executeRaw`
  UPDATE platform.outbox_message SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}::uuid`;
const expire = async (id: string) => client.$executeRaw`
  UPDATE platform.outbox_message SET lease_until = now() - interval '1 second' WHERE id = ${id}::uuid`;
function receiver(failures = 0) {
  const seen = new Set<string>();
  let calls = 0;
  const handler: OutboxHandler = async (message) => {
    calls++;
    if (calls <= failures) throw Object.assign(new Error("offline"), { code: "OFFLINE" });
    seen.add(message.id);
  };
  return { handler, seen, calls: () => calls };
}
function dispatcher(workerId: string, handler?: OutboxHandler, maxAttempts = 8) {
  return createOutboxDispatcher({ client, workerId, maxAttempts,
    handlers: handler ? new Map([["local", handler]]) : new Map() });
}
function command(key: string, input: OutboxEventInput, fail = false) {
  let effects = 0;
  const options: CommandOptions<{ id: string }> = {
    authenticate: async () => ({ userId: "outbox-user", organizationId: "test-org", unitIds: [], roles: ["staff"] }),
    resolveTenant: async () => "test-org", action: "trading:goods-issue:create",
    idempotencyKey: key, payload: { aggregateId: input.aggregateId },
    idempotencyPort: createPrismaIdempotency(client), unitOfWork: () => createTransaction(client),
    domain: async (ctx) => {
      const id = randomUUID();
      await ctx.tx.auditLog.create({ data: { id, actorSub: "outbox-user", action: "outbox.test",
        targetType: "test", targetId: id, outcome: "success", requestId: input.correlationId } });
      ctx.emit(input);
      effects++;
      if (fail) throw Error("rollback");
      return { id };
    },
  };
  return { run: () => runCommand({ requestId: input.correlationId }, options), options, effects: () => effects };
}

test("atomic two events, rollback after emit, and unique collision rollback", async () => {
  const first = event(), second = event();
  const original = command(randomUUID(), first);
  original.options.domain = async (ctx) => {
    const id = randomUUID();
    await ctx.tx.auditLog.create({ data: { id, actorSub: "outbox-user", action: "outbox.test",
      targetType: "test", targetId: id, outcome: "success", requestId: first.correlationId } });
    ctx.emit(first); ctx.emit(second); return { id };
  };
  await original.run();
  assert.equal(await client.outboxMessage.count({ where: { aggregateId: { in: [first.aggregateId, second.aggregateId] } } }), 2);
  assert.deepEqual((await row(first.aggregateId)).payload, first.payload);
  assert.equal((await row(second.aggregateId)).correlationId, second.correlationId);

  const bad = event();
  await assert.rejects(command(randomUUID(), bad, true).run(), /rollback/);
  assert.equal(await client.outboxMessage.count({ where: { aggregateId: bad.aggregateId } }), 0);
  assert.equal(await client.auditLog.count({ where: { requestId: bad.correlationId } }), 0);

  const duplicate = event();
  const sample = command(randomUUID(), duplicate);
  sample.options.domain = async (ctx) => {
    ctx.emit(duplicate); ctx.emit(duplicate);
    return { id: randomUUID() };
  };
  await assert.rejects(sample.run());
  assert.equal(await client.outboxMessage.count({ where: { aggregateId: duplicate.aggregateId } }), 0);
});

test("T02 caveat: 20 concurrent same-key commands create one effect, one record, one row; delivery once", async () => {
  const input = event(), key = randomUUID(), sample = command(key, input);
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const port = sample.options.idempotencyPort!;
  sample.options.idempotencyPort = { ...port, lookup: async (scope) => {
    const outcome = await port.lookup(scope);
    if (++arrived <= 20) { if (arrived === 20) release(); await barrier; }
    return outcome;
  } };
  const values = await Promise.all(Array.from({ length: 20 }, () => sample.run()));
  values.forEach((value) => assert.deepEqual(value, values[0]));
  assert.equal(sample.effects(), 1);
  assert.equal(await client.auditLog.count({ where: { requestId: input.correlationId } }), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { idempotencyKey: key, state: "completed" } }), 1);
  assert.equal(await client.outboxMessage.count({ where: { aggregateId: input.aggregateId } }), 1);
  assert.deepEqual(await sample.run(), values[0]);
  assert.equal(await client.outboxMessage.count({ where: { aggregateId: input.aggregateId } }), 1);
  const target = receiver();
  const result = await dispatcher("closure", target.handler).tick();
  assert.equal(result.delivered, 1);
  assert.equal(target.seen.size, 1);
  assert.equal((await row(input.aggregateId)).status, "delivered");
});

test("expired lease reclaimed; crash after send redelivers but receiver dedupes; fencing rejects zombie", async () => {
  const before = event(); await enqueue(before);
  const target = receiver();
  assert.ok((await dispatcher("stats").stats()).pending >= 1);
  const a = dispatcher("zombie", async () => {
    await expire((await row(before.aggregateId)).id);
    const b = dispatcher("reclaimer", target.handler);
    assert.equal((await b.tick()).delivered, 1);
  });
  assert.deepEqual((await a.tick()).leaseLost, 1);
  assert.equal((await row(before.aggregateId)).attemptCount, 2);

  const afterSend = event(); await enqueue(afterSend);
  const r = receiver();
  const first = dispatcher("after-send", async (message) => {
    await r.handler(message);
    await expire(message.id);
    assert.equal((await dispatcher("restart", r.handler).tick()).delivered, 1);
  });
  assert.equal((await first.tick()).leaseLost, 1);
  assert.equal(r.calls(), 2);
  assert.equal(r.seen.size, 1);

  const failed = event(); await enqueue(failed);
  const stale = dispatcher("stale-failure", async (message) => {
    await expire(message.id);
    assert.equal((await dispatcher("new-owner", receiver().handler).tick()).delivered, 1);
    throw Error("late failure");
  });
  assert.equal((await stale.tick()).leaseLost, 1);
  assert.equal((await row(failed.aggregateId)).status, "delivered");
});

test("two concurrent workers take disjoint rows", async () => {
  const events = Array.from({ length: 12 }, () => event());
  await enqueue(...events);
  const counts = new Map<string, number>();
  const handler: OutboxHandler = async (message) => { counts.set(message.id, (counts.get(message.id) ?? 0) + 1); };
  await Promise.all([dispatcher("race-a", handler).tick(), dispatcher("race-b", handler).tick()]);
  assert.equal(counts.size, 12);
  assert.ok([...counts.values()].every((count) => count === 1));
});

test("full-jitter retry through attempt 8, dead-letter retry, unknown destination", async () => {
  const input = event(); await enqueue(input);
  const failing = dispatcher("fail", receiver(99).handler);
  for (let attempt = 1; attempt <= 8; attempt++) {
    const before = new Date();
    const outcome = await failing.tick();
    assert.equal(attempt === 8 ? outcome.deadLettered : outcome.retried, 1);
    const current = await row(input.aggregateId);
    assert.equal(current.attemptCount, attempt);
    assert.equal(current.lastErrorCode, "OFFLINE");
    if (attempt < 8) {
      assert.equal(current.status, "retry_due");
      assert.ok(current.nextAttemptAt.getTime() >= before.getTime());
      assert.ok(current.nextAttemptAt.getTime() <= Date.now() + Math.min(300_000, 2_000 * 2 ** (attempt - 1)));
      await due(current.id);
    }
  }
  assert.equal((await row(input.aggregateId)).status, "dead_letter");
  assert.equal(await retryDeadLetter(client, (await row(input.aggregateId)).id), true);
  assert.equal((await row(input.aggregateId)).attemptCount, 0);
  assert.equal((await dispatcher("healthy", receiver().handler).tick()).delivered, 1);

  const missing = event(); await enqueue(missing);
  const unknown = dispatcher("unknown", undefined, 2);
  assert.equal((await unknown.tick()).retried, 1);
  assert.equal((await row(missing.aggregateId)).lastErrorCode, "UNKNOWN_DESTINATION");
  await due((await row(missing.aggregateId)).id);
  assert.equal((await unknown.tick()).deadLettered, 1);
  assert.equal((await row(missing.aggregateId)).status, "dead_letter");

  const abandoned = event(); await enqueue(abandoned);
  const abandonedRow = await row(abandoned.aggregateId);
  await client.outboxMessage.update({ where: { id: abandonedRow.id },
    data: { status: "leased", leaseOwner: "crashed", attemptCount: 8,
      leaseUntil: new Date(0) } });
  const capped = await dispatcher("max-attempts", receiver().handler).tick();
  assert.equal(capped.claimed, 0);
  assert.equal(capped.deadLettered, 1);
  assert.equal((await row(abandoned.aggregateId)).lastErrorCode, "LEASE_EXPIRED");
});

test("permanent handler errors dead-letter on first attempt; transient errors retain retry policy", async () => {
  for (const failure of [new PermanentDeliveryError("INVALID_EVENT_PAYLOAD"),
    Object.assign(new Error("unsupported"), { code: "NON_RETRYABLE", reason: "UNSUPPORTED_EVENT_VERSION" })]) {
    const input = event(); await enqueue(input);
    const target = dispatcher("permanent", async () => { throw failure; });
    assert.deepEqual(await target.tick(), { claimed: 1, delivered: 0, retried: 0, deadLettered: 1, leaseLost: 0 });
    const current = await row(input.aggregateId);
    assert.equal(current.status, "dead_letter");
    assert.equal(current.attemptCount, 1);
    assert.equal(current.lastErrorCode, failure.reason);
    assert.equal((await target.tick()).claimed, 0);
  }
  const input = event(); await enqueue(input);
  assert.equal((await dispatcher("transient", async () => { throw Error("offline"); }).tick()).retried, 1);
  assert.equal((await row(input.aggregateId)).status, "retry_due");
  assert.equal((await row(input.aggregateId)).lastErrorCode, "DELIVERY_FAILED");
});

test("ordering gate blocks retry_due predecessor; dead-letter unblocks successor", async () => {
  const id = randomUUID();
  const v2 = event(id, 2), v3 = event(id, 3);
  await enqueue(v2, v3);
  const blocked = dispatcher("ordered", receiver(99).handler, 1);
  assert.equal((await blocked.tick()).deadLettered, 1);
  assert.equal((await client.outboxMessage.findFirstOrThrow({ where: { aggregateId: id, aggregateVersion: 2 } })).status, "dead_letter");
  assert.equal((await dispatcher("next", receiver().handler).tick()).delivered, 1);
  assert.equal((await client.outboxMessage.findFirstOrThrow({ where: { aggregateId: id, aggregateVersion: 3 } })).status, "delivered");

  const other = randomUUID();
  await enqueue(event(other, 2), event(other, 3));
  const retried = dispatcher("ordered-retry", receiver(99).handler);
  assert.equal((await retried.tick()).retried, 1);
  assert.equal((await dispatcher("blocked", receiver().handler).tick()).claimed, 0);
});

test("purge removes expired completed/failed only, leaves processing and unexpired", async () => {
  const port = createPrismaIdempotency(client);
  const key = randomUUID(); await command(key, event()).run();
  const completed = await client.idempotencyRecord.findFirstOrThrow({ where: { idempotencyKey: key } });
  await client.idempotencyRecord.update({ where: { id: completed.id }, data: { expiresAt: new Date(0) } });
  const processing = randomUUID();
  await client.idempotencyRecord.create({ data: { id: processing, actorOrClient: "purge-user", method: "POST",
    routeKey: "purge", idempotencyKey: randomUUID(), payloadSha256: "a".repeat(64),
    state: "processing", expiresAt: new Date(0) } });
  assert.equal(await port.purgeExpired(), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { id: processing } }), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { expiresAt: { gt: new Date() }, state: "completed" } }) > 0, true);
});

test("SIGKILL/restart real worker process preserves 20 messages across before/after-send crashes", async () => {
  const inputs = Array.from({ length: 20 }, () => event()); await enqueue(...inputs);
  const ids = new Set(inputs.map((input) => input.aggregateId));
  const received = new Set<string>();
  const queues = new WeakMap<ChildProcess, { stage: string; id: string }[]>();
  function start(mode: string) {
    const child = fork("tests/platform/outbox-worker.child.ts", [mode], {
      execArgv: ["--require", "tsx/cjs"], env: { ...process.env }, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    queues.set(child, []);
    child.on("message", (message) => queues.get(child)!.push(message as { stage: string; id: string }));
    return child;
  }
  async function next(child: ChildProcess): Promise<{ stage: string; id: string }> {
    for (let i = 0; i < 200; i++) {
      const value = queues.get(child)!.shift();
      if (value) return value;
      if (child.exitCode !== null || child.signalCode !== null) throw Error("child exited");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("child timed out");
  }
  const before = start("before");
  try {
    const signal = await next(before); assert.equal(signal.stage, "before");
    before.kill("SIGKILL"); await expire(signal.id);
    const after = start("after");
    try {
      const signal2 = await next(after); assert.equal(signal2.stage, "received");
      received.add(signal2.id);
      after.kill("SIGKILL"); await expire(signal2.id);
      const healthy = start("normal");
      try {
        for (let i = 0; i < 400; i++) {
          if (await client.outboxMessage.count({ where: { aggregateId: { in: [...ids] }, status: "delivered" } }) === 20) break;
          const signal3 = queues.get(healthy)!.shift();
          if (signal3) {
            assert.equal(signal3.stage, "received");
            received.add(signal3.id);
            healthy.send("ack");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(await client.outboxMessage.count({ where: { aggregateId: { in: [...ids] }, status: "delivered" } }), 20);
        assert.equal(received.size, 20);
      } finally { healthy.kill("SIGKILL"); }
    } finally { after.kill("SIGKILL"); }
  } finally { before.kill("SIGKILL"); }
});

test("federation outbound persists retry and matching ACK attempts in PostgreSQL", async () => {
  const payload = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
  const partnerId = randomUUID();
  await client.partner.create({ data: { id: partnerId, issuerInstanceId: "B", code: randomUUID(),
    displayName: "Receiver B", createdBySub: "fixture" } });
  await client.partnerConnection.create({ data: { id: randomUUID(), partnerId,
    endpointUrl: "https://partner.example/api/v1/federation/events",
    outboundTokenUrl: "https://identity.example/token", outboundClientId: "client-a",
    outboundSecretRef: "env:PARTNER_SECRET", outboundAudience: "partner-b",
    inboundClientId: randomUUID(), status: "active" } });
  const input: OutboxEventInput = { aggregateType: "document", aggregateId: payload.sourceDocument.id,
    aggregateVersion: 2, eventType: payload.eventType, schemaVersion: "1", payload,
    destination: "federation", correlationId: payload.correlationId };
  await enqueue(input);
  const message = await row(input.aggregateId);
  let sends = 0;
  const handler = createFederationOutboundHandler(client, "A", { resolveSecret: async () => "fixture-secret",
    fetcher: async (url) => {
      if (String(url).includes("identity")) return new Response(JSON.stringify({ access_token: "token",
        token_type: "Bearer" }), { status: 200 });
      sends++;
      if (sends === 1) throw new Error("B offline");
      return new Response(JSON.stringify({ messageId: payload.messageId, ackId: randomUUID(),
        acceptedAt: new Date().toISOString(), status: "validated" }), { status: 202 });
    } });
  const worker = createOutboxDispatcher({ client, workerId: randomUUID(),
    handlers: new Map([["federation", handler]]) });
  assert.equal((await worker.tick()).retried, 1);
  const first = await client.deliveryAttempt.findFirstOrThrow({ where: { outboxId: message.id } });
  assert.equal(first.result, "retry");
  assert.equal(first.errorCode, "OUTBOUND_UNAVAILABLE");
  assert.equal(first.endpointHost, "partner.example");
  await due(message.id);
  assert.equal((await worker.tick()).delivered, 1);
  const attempts = await client.deliveryAttempt.findMany({ where: { outboxId: message.id },
    orderBy: { attemptNo: "asc" } });
  assert.deepEqual(attempts.map((item) => [item.attemptNo, item.result]), [[1, "retry"], [2, "ack"]]);
  assert.equal(attempts[1].ackMessageId, payload.messageId);
  assert.equal((await row(input.aggregateId)).status, "delivered");
});

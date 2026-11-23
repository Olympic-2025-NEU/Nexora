// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createTransaction, orderForLocking, TransactionTimeoutError } from "../../platform/persistence/transaction";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) {
  throw new Error("Unit-of-work integration tests require an isolated migrated test database");
}

const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });
const admin = connect(process.env.DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
const work = createTransaction(app, { timeoutMs: 5_000, maxRetries: 2, retryDelayMs: 10 });
after(async () => Promise.all([admin.$disconnect(), app.$disconnect()]));

async function seed(aggregateId: string, stockKeys: string[], quantity: number) {
  await admin.$executeRaw`INSERT INTO platform.tx_spike_aggregate (id) VALUES (${aggregateId}::uuid)`;
  for (const key of stockKeys) {
    await admin.$executeRaw`
      INSERT INTO platform.tx_spike_stock (stock_key, quantity)
      VALUES (${key}, ${quantity}) ON CONFLICT (stock_key) DO NOTHING`;
  }
}

function aggregateRepository(tx: Prisma.TransactionClient) {
  return {
    confirm(id: string) {
      return tx.$executeRaw`
        UPDATE platform.tx_spike_aggregate SET state = 'confirmed', version = version + 1
        WHERE id = ${id}::uuid AND state = 'draft' AND version = 1`;
    },
  };
}

function inventoryRepository(tx: Prisma.TransactionClient) {
  return {
    decrement(key: string, quantity: number) {
      return tx.$executeRaw`
        UPDATE platform.tx_spike_stock SET quantity = quantity - ${quantity}
        WHERE stock_key = ${key} AND quantity >= ${quantity}`;
    },
    movement(id: string, aggregateId: string, key: string, quantity: number) {
      return tx.$executeRaw`
        INSERT INTO platform.tx_spike_movement (id, aggregate_id, stock_key, delta)
        VALUES (${id}::uuid, ${aggregateId}::uuid, ${key}, ${-quantity})`;
    },
  };
}

function outboxRepository(tx: Prisma.TransactionClient) {
  return {
    enqueue(id: string, aggregateId: string) {
      return tx.$executeRaw`
        INSERT INTO platform.tx_spike_outbox (id, aggregate_id, event_type)
        VALUES (${id}::uuid, ${aggregateId}::uuid, 'aggregate.confirmed')`;
    },
  };
}

type Step = "aggregate" | "stock" | "movement" | "audit" | "outbox";
async function confirm(aggregateId: string, stockKeys: string[], quantity: number, failAfter?: Step) {
  const requestId = randomUUID();
  const fail = (step: Step) => {
    if (failAfter === step) throw new Error(`injected after ${step}`);
  };
  return work.run(async (tx) => {
    const aggregate = aggregateRepository(tx);
    const inventory = inventoryRepository(tx);
    const outbox = outboxRepository(tx);
    if (await aggregate.confirm(aggregateId) !== 1) throw new Error("stale aggregate version");
    fail("aggregate");
    for (const key of orderForLocking(stockKeys, (value) => value)) {
      if (await inventory.decrement(key, quantity) !== 1) throw new Error("insufficient stock");
      fail("stock");
      await inventory.movement(randomUUID(), aggregateId, key, quantity);
    }
    fail("movement");
    await tx.auditLog.create({ data: {
      id: randomUUID(), actorSub: "p03-t02-test", action: "aggregate.confirm",
      targetType: "tx_spike_aggregate", targetId: aggregateId,
      outcome: "success", requestId, beforeSummary: { state: "draft" },
      afterSummary: { state: "confirmed" },
    } });
    fail("audit");
    await outbox.enqueue(randomUUID(), aggregateId);
    fail("outbox");
  });
}

async function state(aggregateId: string, stockKey: string) {
  const [aggregate] = await admin.$queryRaw<{ state: string; version: number }[]>`
    SELECT state, version FROM platform.tx_spike_aggregate WHERE id = ${aggregateId}::uuid`;
  const [stock] = await admin.$queryRaw<{ quantity: number }[]>`
    SELECT quantity FROM platform.tx_spike_stock WHERE stock_key = ${stockKey}`;
  const [movement] = await admin.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM platform.tx_spike_movement
    WHERE aggregate_id = ${aggregateId}::uuid`;
  const [outbox] = await admin.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM platform.tx_spike_outbox
    WHERE aggregate_id = ${aggregateId}::uuid`;
  const audit = await admin.auditLog.count({ where: { targetType: "tx_spike_aggregate", targetId: aggregateId } });
  return {
    aggregate, quantity: stock.quantity,
    movement: Number(movement.count), outbox: Number(outbox.count), audit,
  };
}

test("injected failure after each write rolls back aggregate, stock, movement, audit and outbox", async () => {
  for (const step of ["aggregate", "stock", "movement", "audit", "outbox"] as const) {
    const aggregateId = randomUUID();
    const stockKey = `rollback-${step}-${randomUUID()}`;
    await seed(aggregateId, [stockKey], 10);
    await assert.rejects(confirm(aggregateId, [stockKey], 6, step), new RegExp(`injected after ${step}`));
    assert.deepEqual(await state(aggregateId, stockKey), {
      aggregate: { state: "draft", version: 1 }, quantity: 10,
      movement: 0, outbox: 0, audit: 0,
    });
  }
});

test("successful command commits every write once", async () => {
  const aggregateId = randomUUID();
  const stockKey = `success-${randomUUID()}`;
  await seed(aggregateId, [stockKey], 10);
  await confirm(aggregateId, [stockKey], 6);
  assert.deepEqual(await state(aggregateId, stockKey), {
    aggregate: { state: "confirmed", version: 2 }, quantity: 4,
    movement: 1, outbox: 1, audit: 1,
  });
  await assert.rejects(confirm(aggregateId, [stockKey], 6), /stale aggregate version/);
  assert.equal((await state(aggregateId, stockKey)).movement, 1);
});

test("two writers competing for eight units produce exactly one six-unit confirm", async () => {
  const ids = [randomUUID(), randomUUID()];
  const stockKey = `contention-${randomUUID()}`;
  await seed(ids[0], [stockKey], 8);
  await seed(ids[1], [stockKey], 8);
  const results = await Promise.allSettled(ids.map((id) => confirm(id, [stockKey], 6)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const snapshots = await Promise.all(ids.map((id) => state(id, stockKey)));
  assert.equal(snapshots[0].quantity, 2);
  assert.equal(snapshots.filter((row) => row.aggregate.state === "confirmed").length, 1);
  assert.equal(snapshots.reduce((sum, row) => sum + row.movement, 0), 1);
  assert.equal(snapshots.reduce((sum, row) => sum + row.audit, 0), 1);
  assert.equal(snapshots.reduce((sum, row) => sum + row.outbox, 0), 1);
});

test("opposite caller order acquires stock rows in canonical order without deadlock", async () => {
  const keys = [`lock-a-${randomUUID()}`, `lock-b-${randomUUID()}`];
  const ids = [randomUUID(), randomUUID()];
  await seed(ids[0], keys, 100);
  await seed(ids[1], keys, 100);
  const [before] = await admin.$queryRaw<{ deadlocks: bigint }[]>`
    SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`;
  const startedAt = Date.now();
  const results = await Promise.allSettled([
    confirm(ids[0], keys, 1),
    confirm(ids[1], [...keys].reverse(), 1),
  ]);
  const elapsedMs = Date.now() - startedAt;
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  const [afterStats] = await admin.$queryRaw<{ deadlocks: bigint }[]>`
    SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`;
  assert.equal(afterStats.deadlocks, before.deadlocks);
  for (const id of ids) {
    const snapshot = await state(id, keys[0]);
    assert.equal(snapshot.quantity, 98);
    assert.equal(snapshot.aggregate.state, "confirmed");
    assert.equal(snapshot.movement, 2);
    assert.equal(snapshot.audit, 1);
    assert.equal(snapshot.outbox, 1);
  }
  console.log(`canonical row order: 2 concurrent commands, ${elapsedMs}ms, deadlocks=0`);
});

test("real Prisma transaction timeout maps to a stable error without retry", async () => {
  let attempts = 0;
  const shortWork = createTransaction(app, { timeoutMs: 50, maxRetries: 2, retryDelayMs: 0 });
  await assert.rejects(shortWork.run(async (tx) => {
    attempts++;
    await tx.$queryRaw`SELECT pg_sleep(0.2)`;
  }), TransactionTimeoutError);
  assert.equal(attempts, 1);
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPrismaIdempotency } from "../../platform/http/idempotency";
import { mapCommandError } from "../../platform/http/error-mapping";
import { runCommand, type CommandContext, type CommandOptions } from "../../platform/http/pipeline";
import { createTransaction } from "../../platform/persistence/transaction";

if (process.env.NEXORA_TEST_DB !== "1" || !process.env.APP_DATABASE_URL) {
  throw new Error("Idempotency integration tests require NEXORA_TEST_DB=1 and APP_DATABASE_URL for an isolated database");
}

const client = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
after(async () => client.$disconnect());
const port = createPrismaIdempotency(client);
const unitOfWork = () => createTransaction(client);

function command(requestId: string, key: string, payload: unknown, actorId = "test-user") {
  let effects = 0;
  const options: CommandOptions<{ id: string; accepted: boolean }> = {
    authenticate: async () => ({ userId: actorId, organizationId: "test-org", unitIds: [], roles: ["inventory_clerk"] }),
    resolveTenant: async () => "test-org",
    action: "trading:issue:create",
    idempotencyKey: key,
    payload,
    idempotencyPort: port,
    unitOfWork,
    domain: async ({ tx }) => {
      effects++;
      const id = randomUUID();
      await tx.auditLog.create({ data: {
        id, actorSub: actorId, action: "idempotency.test", targetType: "test",
        targetId: id, outcome: "success", requestId, beforeSummary: {}, afterSummary: {},
      } });
      return { id, accepted: true };
    },
  };
  const run = () => runCommand({ requestId } satisfies CommandContext, options);
  const rows = () => client.auditLog.count({ where: { requestId } });
  return { options, run, rows, effects: () => effects };
}

test("20 simultaneous commands commit one effect and replay one stored response", async () => {
  const key = randomUUID();
  const sample = command(randomUUID(), key, { b: 2, a: 1 });
  let arrived = 0;
  let release!: () => void;
  const allLookedUp = new Promise<void>((resolve) => { release = resolve; });
  sample.options.idempotencyPort = {
    ...port,
    async lookup(scope) {
      const outcome = await port.lookup(scope);
      if (++arrived <= 20) {
        if (arrived === 20) release();
        await allLookedUp;
      }
      return outcome;
    },
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => sample.run()));
  for (const value of results) assert.deepEqual(value, results[0]);
  assert.equal(sample.effects(), 1);
  assert.equal(await sample.rows(), 1);
  const record = await client.idempotencyRecord.findUniqueOrThrow({ where: {
    actorOrClient_method_routeKey_idempotencyKey: {
      actorOrClient: "test-user", method: "POST", routeKey: sample.options.action, idempotencyKey: key,
    },
  } });
  assert.equal(record.state, "completed");
  assert.deepEqual(record.responseBody, results[0]);
  assert.equal(record.responseStatus, null);
  assert.equal(record.resourceId, results[0].id);
  assert.equal(await client.idempotencyRecord.count({ where: { id: record.id } }), 1);

  assert.deepEqual(await sample.run(), results[0]);
  assert.equal(sample.effects(), 1);
  assert.equal(await sample.rows(), 1);
  const reordered = command(randomUUID(), key, { a: 1, b: 2 });
  assert.deepEqual(await reordered.run(), results[0]);
  assert.equal(reordered.effects(), 0);

  const mismatch = command(randomUUID(), key, { a: 3 });
  await assert.rejects(mismatch.run(), (error) => {
    assert.deepEqual(mapCommandError(error, "rid"), {
      status: 409, body: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict", requestId: "rid" },
    });
    return true;
  });
  assert.equal(mismatch.effects(), 0);
  assert.equal(await sample.rows(), 1);
});

test("domain rollback erases claim and effect; retry may use same or different payload", async () => {
  const key = randomUUID();
  const sample = command(randomUUID(), key, { value: 1 });
  const original = sample.options.domain;
  sample.options.domain = async (ctx) => {
    await original(ctx);
    throw new Error("simulate crash before commit");
  };
  await assert.rejects(sample.run(), /simulate crash before commit/);
  assert.equal(await sample.rows(), 0);
  assert.equal(await client.idempotencyRecord.count({ where: { idempotencyKey: key } }), 0);
  sample.options.domain = original;
  sample.options.payload = { value: 2 };
  const result = await sample.run();
  assert.equal(result.accepted, true);
  assert.equal(await sample.rows(), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { idempotencyKey: key, state: "completed" } }), 1);
});

test("expired record is atomically taken over; purge removes only expired completed rows", async () => {
  const key = randomUUID();
  const first = command(randomUUID(), key, { value: 1 });
  const original = await first.run();
  const scope = { actorOrClient: "test-user", method: "POST", routeKey: first.options.action, idempotencyKey: key };
  await client.idempotencyRecord.update({ where: { actorOrClient_method_routeKey_idempotencyKey: scope },
    data: { expiresAt: new Date(Date.now() - 1_000) } });
  const next = command(randomUUID(), key, { value: 2 });
  const updated = await next.run();
  assert.notEqual(updated.id, original.id);
  assert.equal(await next.rows(), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { idempotencyKey: key } }), 1);
  const record = await client.idempotencyRecord.findUniqueOrThrow({ where: { actorOrClient_method_routeKey_idempotencyKey: scope } });
  assert.deepEqual(record.responseBody, updated);
  assert.equal(record.resourceId, updated.id);
  assert.equal(await port.purgeExpired(), 0);
  await client.idempotencyRecord.update({ where: { id: record.id }, data: { expiresAt: new Date(0) } });
  assert.equal(await port.purgeExpired(), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { id: record.id } }), 0);
});

test("same key from different actors remains independent", async () => {
  const key = randomUUID();
  const a = command(randomUUID(), key, { value: 1 }, "user-a");
  const b = command(randomUUID(), key, { value: 1 }, "user-b");
  const [one, two] = await Promise.all([a.run(), b.run()]);
  assert.notEqual(one.id, two.id);
  assert.equal(await client.idempotencyRecord.count({ where: { idempotencyKey: key } }), 2);
});

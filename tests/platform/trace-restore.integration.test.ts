// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildHandlerMap } from "../../composition/event-handlers";
import { createPrismaTraceProjectorPort } from "../../contexts/traceability/infrastructure/projector-repos";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";
import { traceConsumers } from "../../workers/trace-projector";

if (process.env.NEXORA_TEST_TRACE !== "1" || !process.env.APP_DATABASE_URL ||
    !process.env.CORE_DATABASE_URL) throw new Error("Disposable restore database required");
const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });
const app = connect(process.env.APP_DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
after(async () => { await Promise.all([app.$disconnect(), core.$disconnect()]); });

test("P08 restored trace source replays to the same checksum and graph", async () => {
  const records = await core.coreRecord.findMany({ where: { kind: "trace_projection" },
    orderBy: { sourceId: "asc" } });
  assert.ok(records.length >= 2);
  const before = records.map((row) => ({ id: row.id, checksumHex: row.checksumHex,
    version: row.version, sourceId: row.sourceId }));
  const eventCount = await app.traceEvent.count();
  const linkCount = await app.traceLink.count();
  const port = createPrismaTraceProjectorPort(app, core, "trace-local");
  for (const row of records) await port.rebuild(row.sourceId);
  const message = await app.outboxMessage.findFirstOrThrow({ where: { destination: "traceability",
    eventType: "trading.transfer.confirmed.v1", status: "delivered" } });
  await app.outboxMessage.update({ where: { id: message.id }, data: {
    status: "retry_due", deliveredAt: null, nextAttemptAt: new Date(Date.now() - 1000) } });
  const dispatcher = createOutboxDispatcher({ client: app, workerId: `trace-restore-${randomUUID()}`,
    handlers: buildHandlerMap({ traceability: traceConsumers(app, core, "trace-local") }) });
  assert.equal((await dispatcher.tick()).delivered, 1);
  const afterRows = await core.coreRecord.findMany({ where: { kind: "trace_projection" },
    orderBy: { sourceId: "asc" } });
  assert.deepEqual(afterRows.map((row) => ({ id: row.id, checksumHex: row.checksumHex,
    version: row.version, sourceId: row.sourceId })), before);
  assert.equal(await app.traceEvent.count(), eventCount);
  assert.equal(await app.traceLink.count(), linkCount);
});

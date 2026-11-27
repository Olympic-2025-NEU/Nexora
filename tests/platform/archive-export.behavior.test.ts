// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { createArchiveExporter } from "../../workers/archive-export";

function harness(types: string[]) {
  const start = Date.parse("2026-11-27T00:00:00.000Z");
  const events = types.map((eventType, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    status: "delivered",
    deliveredAt: new Date(start + index * 1000),
    createdAt: new Date(start + index * 1000),
    eventType,
    schemaVersion: 1,
    aggregateType: "batch",
    aggregateId: "batch-1",
    aggregateVersion: index + 1,
    correlationId: "archive-test",
    payload: { batchId: "batch-1" },
  }));
  const manifests: { builtAt: Date; payload: { checkpoint: string; sourceMinId: string; sourceMaxId: string } }[] = [];
  const app = {
    outboxMessage: {
      findMany: async (query: {
        where: { OR?: [{ deliveredAt: { gt: Date } }, { deliveredAt: Date; id: { gt: string } }] };
        take: number;
      }) => {
        const cursor = query.where.OR;
        return events.filter((event) => !cursor ||
          event.deliveredAt > cursor[0].deliveredAt.gt ||
          (event.deliveredAt.getTime() === cursor[1].deliveredAt.getTime() && event.id > cursor[1].id.gt))
          .slice(0, query.take);
      },
    },
  };
  const core = {
    coreRecord: {
      findMany: async () => [...manifests].reverse(),
      create: async ({ data }: { data: { builtAt: Date; payload: typeof manifests[number]["payload"] } }) => {
        manifests.push({ builtAt: data.builtAt, payload: data.payload });
      },
    },
  };
  const env = {
    S3_ENDPOINT: "http://127.0.0.1:1",
    S3_ACCESS_KEY: "test",
    S3_SECRET_KEY: "test",
    S3_BUCKET_PRIVATE: "test",
    NEXORA_ISSUER_INSTANCE_ID: "nexora-a",
  };
  return { events, manifests, app, core, env };
}

test("archive drains more than 1,000 delivered events without losing the cursor", async () => {
  const h = harness(Array.from({ length: 1001 }, () => "receipt.confirmed.v1"));
  const exporter = createArchiveExporter(h.app as never, h.core as never, h.env, async () => {});
  let exported = 0;
  for (let attempt = 0; attempt < 7; attempt++) exported += (await exporter.exportOnce()).exported;
  assert.equal(exported, h.events.length);
  assert.equal((await exporter.exportOnce()).exported, 0);
  assert.equal(h.manifests.at(-1)?.payload.sourceMaxId, h.events.at(-1)?.id);
});

test("a failed partition write cannot skip later events from another partition", async () => {
  const h = harness(["a.v1", "b.v1", "a.v1"]);
  let failB = true;
  const exporter = createArchiveExporter(h.app as never, h.core as never, h.env, async (key) => {
    if (key.includes("/b.v1/") && failB) {
      failB = false;
      throw new Error("temporary object store outage");
    }
  });
  await assert.rejects(exporter.exportOnce(), /temporary object store outage/);
  assert.equal(h.manifests.length, 1);
  assert.equal(h.manifests[0]?.payload.sourceMaxId, h.events[0]?.id);
  assert.equal((await exporter.exportOnce()).exported, 2);
  assert.deepEqual(h.manifests.map((row) => row.payload.sourceMaxId), h.events.map((row) => row.id));
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { ingestOtReading, listOtReadingsForBatch, loadDeviceRegistry, OtIngestError } from "../../contexts/traceability/application/ot-ingest";
import { readInput } from "../../contexts/traceability/application/ot-http";
import { checkPolicy } from "../../platform/access/policy";

const batchId = "00000000-0000-4000-8000-000000000099";
const input = (observedAt = new Date().toISOString()) => ({
  deviceId: "sim-temp-a1",
  readingId: "reading-1",
  batchId,
  value: "4.500",
  observedAt,
});

test("device registry loads demo simulators", () => {
  const registry = loadDeviceRegistry();
  assert.equal(registry.simulated, true);
  assert.ok(registry.devices.some((device) => device.deviceId === "sim-temp-a1"));
});

test("OT ingest policy permits operators and denies read-only actors", () => {
  for (const role of ["administrator", "inventory_clerk"]) {
    assert.equal(checkPolicy({ roles: [role] } as never, "ops:ot:ingest").allowed, true);
  }
  for (const role of ["issue_approver", "auditor", "partner", "sales_clerk"]) {
    assert.equal(checkPolicy({ roles: [role] } as never, "ops:ot:ingest").allowed, false);
  }
});

test("HTTP input rejects extra fields and oversized payloads", async () => {
  const request = (body: string) => new NextRequest("http://localhost/api/v1/ot/readings", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
  await assert.rejects(
    () => readInput(request(JSON.stringify({ ...input(), qualityState: "accepted" }))),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_JSON_INVALID",
  );
  await assert.rejects(
    () => readInput(request(JSON.stringify({ ...input(), padding: "x".repeat(4096) }))),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_PAYLOAD_TOO_LARGE",
  );
});

test("unknown device maps to OT_DEVICE_UNKNOWN", async () => {
  const registry = loadDeviceRegistry();
  const app = { batch: { findUnique: async () => ({ id: batchId }) } };
  const core = {
    coreRecord: {
      findUnique: async () => null,
      create: async () => {
        throw new Error("should not create");
      },
    },
  };
  await assert.rejects(
    () => ingestOtReading(app as never, core as never, registry, {
        deviceId: "unknown-device",
        readingId: "r1",
        batchId,
        value: "1.0",
        observedAt: new Date().toISOString(),
      }, "nexora-a"),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_DEVICE_UNKNOWN",
  );
});

test("device allowlist is scoped to the local instance", async () => {
  await assert.rejects(
    () => ingestOtReading({} as never, {} as never, loadDeviceRegistry(), input(), "nexora-b"),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_DEVICE_UNKNOWN",
  );
});

test("unknown batch is rejected before an OT record is written", async () => {
  const app = { batch: { findUnique: async () => null } };
  await assert.rejects(
    () => ingestOtReading(app as never, {} as never, loadDeviceRegistry(), input(), "nexora-a"),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_BATCH_NOT_FOUND",
  );
});

test("replay stays idempotent after the reading becomes stale", async (t) => {
  let clock = Date.parse("2026-11-27T00:00:00.000Z");
  t.mock.method(Date, "now", () => clock);
  const reading = input(new Date(clock - 60_000).toISOString());
  const app = { batch: { findUnique: async () => ({ id: batchId }) } };
  let saved: { id: string; checksumHex: string; payload: Record<string, unknown> } | null = null;
  let creates = 0;
  const core = { coreRecord: {
    findUnique: async () => saved,
    create: async ({ data }: { data: { id: string; checksumHex: string; payload: Record<string, unknown> } }) => {
      creates++;
      saved = { id: data.id, checksumHex: data.checksumHex, payload: data.payload };
      return saved;
    },
  } };
  const first = await ingestOtReading(app as never, core as never, loadDeviceRegistry(), reading, "nexora-a");
  clock += 20 * 60_000;
  const replay = await ingestOtReading(app as never, core as never, loadDeviceRegistry(), reading, "nexora-a");
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.checksumHex, first.checksumHex);
  assert.equal(creates, 1);
  await assert.rejects(
    () => ingestOtReading(app as never, core as never, loadDeviceRegistry(),
      { ...reading, value: "5.000" }, "nexora-a"),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_HASH_CONFLICT",
  );
});

test("lot OT query filters by batch before limiting results", async () => {
  let where: unknown;
  const core = { coreRecord: { findMany: async (query: { where: unknown }) => {
    where = query.where;
    return [];
  } } };
  await listOtReadingsForBatch(core as never, batchId);
  assert.deepEqual(where, {
    kind: "ot_reading", sourceType: "simulator", payload: { path: ["batchId"], equals: batchId },
  });
});

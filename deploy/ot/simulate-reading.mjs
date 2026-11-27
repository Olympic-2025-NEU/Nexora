// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Simulated OT temperature ingest (P12-T03). Does not change stock/quality.
 * Usage: node deploy/ot/simulate-reading.mjs a --batch <uuid> [--device sim-temp-a1] [--value 4.5] [--stale]
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    batch: { type: "string" },
    device: { type: "string", default: "sim-temp-a1" },
    value: { type: "string", default: "4.500" },
    stale: { type: "boolean", default: false },
    reading: { type: "string" },
  },
  allowPositionals: true,
});
const instance = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "a";
const env = parseEnv(readFileSync(`deploy/instances/${instance}.env`, "utf8"));
const batchId = values.batch;
if (!batchId) {
  console.error("Missing --batch <uuid>");
  process.exit(2);
}
const registry = JSON.parse(readFileSync("deploy/ot/device-registry.example.json", "utf8"));
const device = registry.devices.find((row) => row.deviceId === values.device);
if (!device) {
  console.error(JSON.stringify({ error: "OT_DEVICE_UNKNOWN", deviceId: values.device }));
  process.exit(3);
}
const observedAt = values.stale
  ? new Date(Date.now() - ((device.maxStaleSeconds ?? 900) + 60) * 1000)
  : new Date();
const readingId = values.reading || randomUUID();
const payload = {
  schemaVersion: 1,
  deviceId: values.device,
  readingId,
  batchId,
  metric: "temperature_c",
  value: values.value,
  unit: "C",
  observedAt: observedAt.toISOString(),
  qualityState: values.stale ? "stale" : "accepted",
  simulated: true,
};
const checksumHex = createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
const sourceId = `${values.device}:${readingId}`;
const core = new PrismaClient({ datasources: { db: { url: env.CORE_DATABASE_URL } } });
const existing = await core.coreRecord.findUnique({
  where: { kind_sourceType_sourceId: { kind: "ot_reading", sourceType: "simulator", sourceId } },
});
if (existing) {
  if (existing.checksumHex === checksumHex) {
    console.log(JSON.stringify({ ok: true, reused: true, id: existing.id, sourceId, qualityState: payload.qualityState }));
    await core.$disconnect();
    process.exit(0);
  }
  console.error(JSON.stringify({ error: "OT_HASH_CONFLICT", sourceId }));
  await core.$disconnect();
  process.exit(4);
}
const created = await core.coreRecord.create({
  data: {
    id: randomUUID(),
    kind: "ot_reading",
    sourceType: "simulator",
    sourceId,
    payload,
    visibility: "private",
    policyVersion: "p12-t03-v1",
    checksumHex,
    builtAt: observedAt,
  },
});
console.log(JSON.stringify({
  ok: true,
  reused: false,
  id: created.id,
  sourceId,
  qualityState: payload.qualityState,
  simulated: true,
  note: "OT simulator — does not mutate stock or lot quality",
}));
await core.$disconnect();

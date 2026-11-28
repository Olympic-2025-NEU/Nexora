// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";

const KIND = "ot_reading";
const SOURCE_TYPE = "simulator";
const POLICY = "p12-t03-v1";

export type OtIngestInput = {
  deviceId: string;
  readingId: string;
  batchId: string;
  value: string;
  observedAt: string;
};

export type DeviceRegistry = {
  schemaVersion: number;
  simulated: boolean;
  devices: { deviceId: string; instanceId: string; maxStaleSeconds?: number }[];
};

export function loadDeviceRegistry(path = resolve("deploy/ot/device-registry.example.json")): DeviceRegistry {
  return JSON.parse(readFileSync(path, "utf8")) as DeviceRegistry;
}

function checksum(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)!, "utf8").digest("hex");
}

export class OtIngestError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function ingestOtReading(
  app: PrismaClient,
  core: PrismaClient,
  registry: DeviceRegistry,
  input: OtIngestInput,
  instanceId: string,
  audit?: (event: string, detail: Record<string, unknown>) => Promise<void>,
): Promise<{ id: string; checksumHex: string; reused: boolean }> {
  if (registry.schemaVersion !== 1 || registry.simulated !== true) {
    throw new OtIngestError("OT_REGISTRY_INVALID", 503);
  }
  const device = registry.devices.find((row) => row.deviceId === input.deviceId && row.instanceId === instanceId);
  if (!device) {
    await audit?.("ot.device_unknown", { deviceId: input.deviceId });
    throw new OtIngestError("OT_DEVICE_UNKNOWN", 403);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.batchId)) {
    throw new OtIngestError("OT_BATCH_INVALID", 400);
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.readingId)) {
    throw new OtIngestError("OT_READING_ID_INVALID", 400);
  }
  if (!/^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,3})?$/.test(input.value) ||
    Number(input.value) < -50 || Number(input.value) > 100) {
    throw new OtIngestError("OT_VALUE_INVALID", 400);
  }
  const observedAt = new Date(input.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new OtIngestError("OT_TIMESTAMP_INVALID", 400);
  if (observedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new OtIngestError("OT_TIMESTAMP_FUTURE", 400);
  }
  const batch = await app.batch.findUnique({ where: { id: input.batchId }, select: { id: true } });
  if (!batch) throw new OtIngestError("OT_BATCH_NOT_FOUND", 404);
  const maxStale = device.maxStaleSeconds ?? 900;
  const qualityState = (Date.now() - observedAt.getTime()) / 1000 > maxStale ? "stale" : "accepted";

  const payload = {
    schemaVersion: 1 as const,
    deviceId: input.deviceId,
    readingId: input.readingId,
    batchId: input.batchId,
    metric: "temperature_c" as const,
    value: input.value,
    unit: "C" as const,
    observedAt: observedAt.toISOString(),
    qualityState,
    simulated: true as const,
  };
  const checksumHex = checksum(payload);
  const sourceId = `${input.deviceId}:${input.readingId}`;
  const existing = await core.coreRecord.findUnique({
    where: { kind_sourceType_sourceId: { kind: KIND, sourceType: SOURCE_TYPE, sourceId } },
  });
  const sameInput = (record: { payload: unknown }) => {
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return false;
    const saved = record.payload as Record<string, unknown>;
    return saved.deviceId === input.deviceId && saved.readingId === input.readingId &&
      saved.batchId === input.batchId && saved.value === input.value &&
      saved.observedAt === observedAt.toISOString();
  };
  if (existing) {
    if (sameInput(existing)) {
      return { id: existing.id, checksumHex: existing.checksumHex, reused: true };
    }
    await audit?.("ot.hash_conflict", { sourceId });
    throw new OtIngestError("OT_HASH_CONFLICT", 409);
  }
  try {
    const created = await core.coreRecord.create({
      data: {
        id: randomUUID(),
        kind: KIND,
        sourceType: SOURCE_TYPE,
        sourceId,
        payload: payload as Prisma.InputJsonValue,
        visibility: "private",
        policyVersion: POLICY,
        checksumHex,
        builtAt: observedAt,
      },
    });
    await audit?.("ot.reading_accepted", { sourceId, qualityState, simulated: true });
    return { id: created.id, checksumHex, reused: false };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      const again = await core.coreRecord.findUniqueOrThrow({
        where: { kind_sourceType_sourceId: { kind: KIND, sourceType: SOURCE_TYPE, sourceId } },
      });
      if (sameInput(again)) return { id: again.id, checksumHex: again.checksumHex, reused: true };
      throw new OtIngestError("OT_HASH_CONFLICT", 409);
    }
    throw error;
  }
}

export async function listOtReadingsForBatch(core: PrismaClient, batchId: string) {
  const rows = await core.coreRecord.findMany({
    where: { kind: KIND, sourceType: SOURCE_TYPE, payload: { path: ["batchId"], equals: batchId } },
    orderBy: { builtAt: "desc" },
    take: 200,
  });
  return rows
    .map((row) => {
      const payload = row.payload as Record<string, unknown>;
      const observedAt = String(payload.observedAt ?? row.builtAt.toISOString());
      const lagSeconds = Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000));
      return {
        id: row.id,
        deviceId: String(payload.deviceId),
        readingId: String(payload.readingId),
        metric: String(payload.metric),
        value: String(payload.value),
        unit: String(payload.unit),
        observedAt,
        qualityState: String(payload.qualityState),
        simulated: payload.simulated === true,
        asOf: row.builtAt.toISOString(),
        lagSeconds,
      };
    });
}

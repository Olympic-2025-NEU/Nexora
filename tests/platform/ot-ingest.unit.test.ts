// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { loadDeviceRegistry, OtIngestError } from "../../contexts/traceability/application/ot-ingest";

test("device registry loads demo simulators", () => {
  const registry = loadDeviceRegistry();
  assert.equal(registry.simulated, true);
  assert.ok(registry.devices.some((device) => device.deviceId === "sim-temp-a1"));
});

test("unknown device maps to OT_DEVICE_UNKNOWN", async () => {
  const registry = loadDeviceRegistry();
  const core = {
    coreRecord: {
      findUnique: async () => null,
      create: async () => {
        throw new Error("should not create");
      },
    },
  };
  await assert.rejects(
    () => import("../../contexts/traceability/application/ot-ingest").then(({ ingestOtReading }) =>
      ingestOtReading(core as never, registry, {
        deviceId: "unknown-device",
        readingId: "r1",
        batchId: "00000000-0000-4000-8000-000000000099",
        value: "1.0",
        observedAt: new Date().toISOString(),
      })),
    (error: unknown) => error instanceof OtIngestError && error.code === "OT_DEVICE_UNKNOWN",
  );
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Simulated OT temperature ingest through the gateway (P12-T03).
 * Usage: node deploy/ot/simulate-reading.mjs a --batch <uuid> [--reading <id>] [--stale]
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    batch: { type: "string" },
    device: { type: "string" },
    value: { type: "string", default: "4.500" },
    stale: { type: "boolean", default: false },
    reading: { type: "string" },
  },
  allowPositionals: true,
});
const instance = positionals[0] ?? "a";
if (!/^[abc]$/.test(instance) || !values.batch) {
  console.error("Usage: node deploy/ot/simulate-reading.mjs a|b|c --batch <uuid> [--reading <id>] [--stale]");
  process.exit(2);
}
const env = parseEnv(readFileSync(`deploy/instances/${instance}.env`, "utf8"));
if (!env.PUBLIC_BASE_URL || !env.KEYCLOAK_HOST_PORT || !env.KC_DEV_USERNAME || !env.KC_DEV_USER_PASSWORD) {
  console.error("OT_DEMO_CONFIG_MISSING");
  process.exit(2);
}
const registry = JSON.parse(readFileSync("deploy/ot/device-registry.example.json", "utf8"));
const deviceId = values.device ?? `sim-temp-${instance}1`;
const device = registry.devices.find((row) => row.deviceId === deviceId && row.instanceId === `nexora-${instance}`);
if (!device) {
  console.error("OT_DEVICE_UNKNOWN");
  process.exit(3);
}

const observedAt = new Date(Date.now() - (values.stale ? (device.maxStaleSeconds ?? 900) + 60 : 0) * 1000);
const tokenResponse = await fetch(
  `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}/realms/nexora/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "erp-browser",
      username: env.KC_DEV_USERNAME,
      password: env.KC_DEV_USER_PASSWORD,
    }),
    signal: AbortSignal.timeout(15000),
  },
);
if (!tokenResponse.ok) {
  console.error(`OT_AUTH_FAILED ${tokenResponse.status}`);
  process.exit(4);
}
const token = (await tokenResponse.json()).access_token;
const response = await fetch(`${env.PUBLIC_BASE_URL}/api/v1/ot/readings`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    deviceId,
    readingId: values.reading ?? randomUUID(),
    batchId: values.batch,
    value: values.value,
    observedAt: observedAt.toISOString(),
  }),
  signal: AbortSignal.timeout(15000),
});
const result = await response.json();
if (!response.ok) {
  console.error(JSON.stringify({ error: result.error ?? "OT_INGEST_FAILED", status: response.status }));
  process.exit(5);
}
console.log(JSON.stringify({ ...result.data, simulated: true }));

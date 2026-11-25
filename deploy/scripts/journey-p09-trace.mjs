// SPDX-License-Identifier: AGPL-3.0-only
// Read-only A→B→C trace drill. Set DEMO_ONLY=true; never prints tokens or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");
const root = resolve(import.meta.dirname, "../..");
const instances = Object.fromEntries("abc".split("").map((name) => {
  const env = parseEnv(readFileSync(resolve(root, "deploy/instances", `${name}.env`), "utf8"));
  const fixture = JSON.parse(readFileSync(resolve(root, "deploy/instances", name,
    "fixture-manifest.json"), "utf8"));
  assert.equal(fixture.instanceId, `nexora-${name}`);
  return [name, { env, fixture, base: env.PUBLIC_BASE_URL }];
}));
const tokens = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function token(name) {
  const { env } = instances[name];
  const response = await fetch(`http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}` +
    "/realms/nexora/protocol/openid-connect/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "erp-browser",
      username: env.KC_DEV_USERNAME, password: env.KC_DEV_USER_PASSWORD }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${name} staff token HTTP ${response.status}: ${body.error ?? "unknown"}`);
  tokens.set(name, body.access_token);
  return body.access_token;
}
async function api(name, method, path, body) {
  if (!tokens.has(name)) await token(name);
  const send = () => fetch(`${instances[name].base}${path}`, { method,
    headers: { authorization: `Bearer ${tokens.get(name)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await send();
  if (response.status === 401) { await token(name); response = await send(); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${name} ${method} ${path}: HTTP ${response.status} ` +
    JSON.stringify(result).slice(0, 350));
  return result.data;
}
async function until(label, work, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await work();
    if (result) return result;
    await delay(2000);
  }
  throw new Error(`${label} timed out`);
}
function batch(name) { return instances[name].fixture.batchId; }

async function snapshot(name) {
    const id = batch(name);
    const warehouseId = instances[name].fixture.warehouseId;
    const [backward, forward, balances] = await Promise.all([
      api(name, "GET", `/api/v1/lots/${id}/trace/backward?depth=10&limit=100`),
      api(name, "GET", `/api/v1/lots/${id}/trace/forward?depth=10&limit=100`),
      api(name, "GET", `/api/v1/inventory/balances?warehouseId=${warehouseId}&batchId=${id}`),
    ]);
    return { instance: name, batchId: id, balance: Number(balances.find((row) =>
      row.warehouseId === warehouseId && row.batchId === id)?.quantity ?? 0),
      trace: { nodes: backward.nodes?.length, issuers: [...new Set(backward.nodes?.map((row) =>
        row.issuerInstanceId) ?? [])], gaps: backward.gaps?.map((row) => row.reason),
        eventIds: backward.nodes?.map((row) => row.eventId) ?? [] },
      forward: { nodes: forward.nodes?.length, gaps: forward.gaps?.map((row) => row.reason),
        partnerIssuers: [...new Set(forward.impact?.flatMap((row) =>
          row.partner?.issuerInstanceId ? [row.partner.issuerInstanceId] : []) ?? [])],
        eventIds: forward.nodes?.map((row) => row.eventId) ?? [] } };
}
const mode = process.argv[2];
if (mode === "inspect" || mode === "verify" || mode === "verify-offline") {
  const names = mode === "verify-offline" ? "bc" : "abc";
  const rows = await (mode === "inspect"
    ? Promise.all([...names].map(snapshot))
    : until("cross-instance trace", async () => {
      const current = await Promise.all([...names].map(snapshot));
      const byName = Object.fromEntries(current.map((row) => [row.instance, row]));
      const cReady = ["nexora-a", "nexora-b", "nexora-c"]
        .every((issuer) => byName.c.trace.issuers.includes(issuer));
      const bReady = byName.b.trace.issuers.includes("nexora-a");
      const aReady = mode === "verify-offline" ||
        byName.a.forward.partnerIssuers.includes("nexora-c");
      const balancesReady = current.every((row) => row.balance ===
        ({ a: 8, b: 4, c: 4 })[row.instance]);
      return cReady && bReady && aReady && balancesReady ? current : null;
    }));
  for (const row of rows) console.log(JSON.stringify(row));
  if (mode !== "inspect") console.log(`P09 trace ${mode}: PASS`);
} else throw new Error("Expected inspect, verify or verify-offline");

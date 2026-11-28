// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in live P09-T01 drill; uses only ignored demo credentials and Compose projects.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { validateConfig } from "../../deploy/config.mjs";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");
const root = resolve(import.meta.dirname, "../..");
const instances = "abc".split("").map((id) => {
  const file = resolve(root, "deploy", "instances", `${id}.env`);
  const env = parseEnv(readFileSync(file, "utf8"));
  validateConfig(env);
  assert.equal(env.INSTANCE_ID, id);
  assert.equal(env.ORG_CODE, `ORG-${id.toUpperCase()}`);
  assert.equal(env.PUBLIC_BASE_URL, `http://127.0.0.1:${env.GATEWAY_HTTP_PORT}`);
  const manifest = JSON.parse(readFileSync(resolve(root, "deploy", "instances", id,
    "fixture-manifest.json"), "utf8"));
  const appUrl = new URL(env.APP_DATABASE_URL);
  appUrl.hostname = "127.0.0.1"; appUrl.port = env.POSTGRES_HOST_PORT;
  const adminUrl = new URL(appUrl);
  adminUrl.username = env.POSTGRES_USER;
  adminUrl.password = env.POSTGRES_PASSWORD;
  adminUrl.pathname = "/postgres";
  return { id, env, manifest,
    app: new PrismaClient({ datasources: { db: { url: appUrl.href } } }),
    admin: new PrismaClient({ datasources: { db: { url: adminUrl.href } } }) };
});
function compose(id, args) {
  const envFile = resolve(root, "deploy", "instances", `${id}.env`);
  const child = spawnSync("docker", ["compose", "-f", "deploy/compose.yml",
    "-f", "deploy/compose.local-admin.yml", "--env-file", envFile,
    "-p", `nexora-${id}`, "--profile", "apps", ...args],
  { cwd: root, encoding: "utf8" });
  if (child.status !== 0) throw new Error(`Compose ${id} ${args[0]} failed`);
  return child.stdout.trim();
}
async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
}
async function token(item) {
  const response = await request(`${item.env.PUBLIC_BASE_URL}/auth/dev-token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: item.env.KC_DEV_USERNAME,
      password: item.env.KC_DEV_USER_PASSWORD }) });
  assert.equal(response.status, 200, `${item.id} dev token HTTP ${response.status}`);
  const payload = await response.json();
  assert.ok(payload.data?.accessToken, `${item.id} access token missing`);
  return payload.data.accessToken;
}
async function api(item, accessToken, method, path, body, headers = {}) {
  const response = await request(`${item.env.PUBLIC_BASE_URL}${path}`, {
    method, headers: { authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  assert.ok(response.ok, `${item.id} ${method} ${path}: HTTP ${response.status} ${payload.error ?? ""}`);
  return payload.data;
}
async function inspect(item) {
  const [cluster] = await item.admin.$queryRaw`SELECT system_identifier::text AS id FROM pg_control_system()`;
  const org = await item.app.organization.findUniqueOrThrow({ where: { singletonSlot: 1 } });
  assert.equal(org.instanceId, `nexora-${item.id}`);
  assert.equal(org.id, item.manifest.organizationId);
  const members = await item.app.membership.findMany({ where: { status: "active" } });
  for (const role of ["administrator", "staff", "approver"])
    assert.ok(members.some((row) => row.role === role), `${item.id} missing ${role}`);
  for (const peer of item.manifest.partnerIssuers)
    assert.ok(await item.app.partner.findUnique({ where: { issuerInstanceId: peer } }));
  const batch = await item.app.batch.findUniqueOrThrow({ where: { id: item.manifest.batchId } });
  assert.equal(batch.originIssuerInstanceId, "nexora-a");
  assert.equal(batch.originLotId, item.manifest.originLotId);
  const discovery = await request(`http://127.0.0.1:${item.env.KEYCLOAK_HOST_PORT}/realms/nexora/.well-known/openid-configuration`);
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).issuer, item.env.OIDC_ISSUER_URL);
  for (const volume of ["pg_data", "seaweed_data"]) {
    const result = spawnSync("docker", ["volume", "inspect", "--format",
      "{{index .Labels \"com.docker.compose.project\"}}", `nexora-${item.id}_${volume}`],
    { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), `nexora-${item.id}`);
  }
  return cluster.id;
}
async function localReceipt(item) {
  const accessToken = await token(item);
  const before = await item.app.batch.findUniqueOrThrow({ where: { id: item.manifest.batchId } });
  if (before.qualityStatus === "inspect") {
    await api(item, accessToken, "POST", `/api/v1/batches/${before.id}/quality-actions`,
      { action: "mark_available", reason: "P09-T01 isolated demo drill", version: before.version },
      { "if-match": String(before.version) });
  }
  const receipt = await api(item, accessToken, "POST", "/api/v1/receipts", { lines: [{
    warehouseId: item.manifest.warehouseId, productVariantId: item.manifest.productVariantId,
    batchId: item.manifest.batchId, quantity: "1",
    uomId: "aaaaaaaa-0001-4000-8000-000000000001",
  }] });
  assert.equal(receipt.status, "draft");
  const read = await api(item, accessToken, "GET", `/api/v1/receipts/${receipt.id}`);
  assert.equal(read.id, receipt.id);
  const confirmed = await api(item, accessToken, "POST",
    `/api/v1/receipts/${receipt.id}/confirm`, {},
    { "if-match": String(receipt.version), "idempotency-key": randomUUID() });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(await item.app.outboxMessage.count({ where: { aggregateId: receipt.id,
    eventType: "trading.receipt.confirmed.v1" } }), 1);
  return receipt.id;
}
let bStopped = false;
try {
  const ids = await Promise.all(instances.map(inspect));
  assert.equal(new Set(ids).size, 3, "PostgreSQL clusters share an identity");
  for (const item of instances)
    assert.equal(await item.app.stockMovement.count(), 0, `${item.id} fixture stock must start zero`);
  const b = instances[1];
  compose("b", ["stop"]);
  bStopped = true;
  let bUnavailable = false;
  try { await request(b.env.PUBLIC_BASE_URL); } catch { bUnavailable = true; }
  assert.ok(bUnavailable, "B gateway remained available after stop");
  const aReceipt = await localReceipt(instances[0]);
  const cReceipt = await localReceipt(instances[2]);
  compose("b", ["up", "-d", "erp", "gateway", "seaweedfs"]);
  bStopped = false;
  assert.equal((await b.app.organization.findUniqueOrThrow({ where: { singletonSlot: 1 } }))
    .instanceId, "nexora-b");
  assert.equal(await b.app.stockMovement.count(), 0, "B changed during outage");
  const evidence = { postgresClusterIdsDistinct: true, keycloakIssuersDistinct: true,
    bOffline: true, aReceiptId: aReceipt, cReceiptId: cReceipt,
    aOutboxPersisted: true, cOutboxPersisted: true, bStockMovementCount: 0 };
  writeFileSync(resolve(root, "deploy", "instances", "abc-drill-result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log("P09-T01 live A/B/C outage drill PASS");
} finally {
  if (bStopped) compose("b", ["up", "-d", "erp", "gateway", "seaweedfs"]);
  await Promise.all(instances.flatMap((item) => [item.app.$disconnect(), item.admin.$disconnect()]));
}

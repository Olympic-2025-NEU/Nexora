// SPDX-License-Identifier: AGPL-3.0-only
/** Destructive only inside a disposable G09-prefixed A project: AI Draft -> human M03 confirm. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";

if (process.env.DEMO_ONLY !== "true" || process.env.NEXORA_DEMO_PROJECT_PREFIX !== "nexora-g09") {
  throw new Error("G10 live smoke requires DEMO_ONLY=true and the isolated nexora-g09 project prefix");
}
const root = resolve(import.meta.dirname, "../..");
const envFile = resolve(root, "deploy/instances/a.env");
const env = parseEnv(readFileSync(envFile, "utf8"));
if (env.INSTANCE_ID !== "a" || env.GATEWAY_HTTP_PORT !== "21080" ||
    env.KEYCLOAK_HOST_PORT !== "20080" || env.NEXORA_IMAGE_TAG !== "g09-clean" ||
    env.PUBLIC_BASE_URL !== "http://127.0.0.1:21080") {
  throw new Error("Refusing to write outside the disposable A instance");
}
const compose = ["compose", "-f", "deploy/compose.yml", "-f", "deploy/compose.local-admin.yml",
  "--env-file", envFile, "-p", "nexora-g09-a"];
const postgres = execFileSync("docker", [...compose, "ps", "-q", "postgres"],
  { cwd: root, encoding: "utf8" }).trim();
assert.ok(postgres, "Disposable PostgreSQL is not running");
const project = execFileSync("docker", ["inspect", "--format",
  "{{index .Config.Labels \"com.docker.compose.project\"}}", postgres],
{ encoding: "utf8" }).trim();
assert.equal(project, "nexora-g09-a", "PostgreSQL project label mismatch");

const fixture = JSON.parse(readFileSync(resolve(root, "deploy/instances/a/fixture-manifest.json"), "utf8"));
const batchId = fixture.aiDemoLot.batchId;
const warehouseId = fixture.warehouseId;
const tokenResponse = await fetch(`${env.OIDC_ISSUER_URL}/protocol/openid-connect/token`, {
  method: "POST",
  body: new URLSearchParams({ grant_type: "password", client_id: env.OIDC_CLIENT_ID_ERP,
    username: env.KC_DEV_USERNAME, password: env.KC_DEV_USER_PASSWORD }),
  signal: AbortSignal.timeout(10000),
});
assert.equal(tokenResponse.status, 200, "Disposable staff login failed");
const accessToken = (await tokenResponse.json()).access_token;
assert.ok(accessToken);

const proposalRequestId = `g10-ac11-${randomUUID()}`;
async function api(method, path, { body, requestId = proposalRequestId, headers = {} } = {}) {
  const response = await fetch(new URL(path, env.PUBLIC_BASE_URL), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "x-request-id": requestId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${result.error ?? result.code ?? ""}`);
  return result.data;
}
const stockPath = `/api/v1/inventory/balances?batchId=${batchId}&warehouseId=${warehouseId}&limit=20`;
async function stock() {
  const rows = await api("GET", stockPath);
  assert.ok(Array.isArray(rows));
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}
async function draftIds() {
  const rows = await api("GET", "/api/v1/receipts?status=draft");
  assert.ok(Array.isArray(rows));
  return rows.map((row) => row.id).sort();
}
const beforeStock = await stock();
const beforeDrafts = await draftIds();
const proposal = await api("POST", "/api/v1/ai/draft", { body: {
  request: "Lô LOT-A-001 của nexora-b, nhập 5 CÁI",
  batchId,
  fields: { batchId, warehouseId, quantity: "5", unit: "CAI" },
} });
assert.equal(proposal.status, "proposed");
assert.equal(proposal.fields.batchId, batchId);
assert.equal(proposal.fields.warehouseId, warehouseId);
assert.equal(await stock(), beforeStock, "AI proposal changed stock");
assert.deepEqual(await draftIds(), beforeDrafts, "AI proposal created a document");

const created = await api("POST", "/api/v1/ai/draft/create", { body: {
  proposalId: proposal.proposalId, fields: proposal.fields,
} });
assert.equal(created.status, "created");
const documentId = created.draftDocumentId;
const draft = await api("GET", `/api/v1/receipts/${documentId}`);
assert.equal(draft.status, "draft");
assert.equal(await stock(), beforeStock, "AI Draft creation changed stock");

const dbUrl = new URL(env.MIGRATOR_DATABASE_URL);
dbUrl.hostname = "127.0.0.1";
dbUrl.port = env.POSTGRES_HOST_PORT;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl.href } } });
try {
  const beforeAudit = await prisma.auditLog.findMany({
    where: { OR: [{ requestId: proposalRequestId }, { targetId: documentId }] },
    select: { action: true, targetId: true, actorSub: true, requestId: true },
  });
  for (const action of ["ai.draft.proposed", "ai.tool.createReceiptDraft", "ai.draft.created"]) {
    assert.ok(beforeAudit.some((row) => row.action === action), `Missing ${action} audit`);
  }
  assert.ok(!beforeAudit.some((row) => row.action === "trading.document.confirm"),
    "AI triggered a confirm before human action");

  const confirmed = await api("POST", `/api/v1/receipts/${documentId}/confirm`, {
    requestId: `g10-confirm-${randomUUID()}`, body: {},
    headers: { "If-Match": `"${draft.version}"`, "Idempotency-Key": randomUUID() },
  });
  assert.equal(confirmed.status, "confirmed");
  const afterStock = await stock();
  assert.equal(afterStock, beforeStock + Number(proposal.fields.quantity),
    "Human confirm did not post the exact proposed quantity");
  const afterAudit = await prisma.auditLog.findMany({
    where: { targetId: documentId, action: "trading.document.confirm" },
    select: { actorSub: true },
  });
  assert.equal(afterAudit.length, 1, "Expected one human M03 confirmation audit");
  assert.ok(afterAudit[0].actorSub);
  console.log(JSON.stringify({ result: "PASS", project, batchId, warehouseId,
    documentId, proposalId: proposal.proposalId, beforeStock,
    afterProposalStock: beforeStock, afterDraftStock: beforeStock, afterConfirmStock: afterStock,
    aiAuditActions: beforeAudit.filter((row) => row.action.startsWith("ai.")).map((row) => row.action).sort(),
    humanConfirmAudit: afterAudit.length }));
} finally {
  await prisma.$disconnect();
}

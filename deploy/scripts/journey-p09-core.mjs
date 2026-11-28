// SPDX-License-Identifier: AGPL-3.0-only
// Local A→B→C business journey. Run after guarded A/B/C seed and connection setup.
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
  if (env.INSTANCE_ID !== name || fixture.instanceId !== `nexora-${name}` ||
      env.PUBLIC_BASE_URL !== `http://127.0.0.1:${env.GATEWAY_HTTP_PORT}`)
    throw new Error(`Demo instance identity mismatch: ${name}`);
  return [name, { env, fixture, base: env.PUBLIC_BASE_URL }];
}));
const uomId = "aaaaaaaa-0001-4000-8000-000000000001";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const staffTokens = new Map();

async function token(name, role) {
  const { env } = instances[name];
  const account = role === "approver" ? [env.KC_APPROVER_USERNAME, env.KC_APPROVER_PASSWORD]
    : [env.KC_DEV_USERNAME, env.KC_DEV_USER_PASSWORD];
  assert.ok(account[0] && account[1], `${name} ${role} account missing`);
  const response = await fetch(`http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}/realms/nexora/protocol/openid-connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "erp-browser",
      username: account[0], password: account[1] }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${name} ${role} token HTTP ${response.status}: ${result.error ?? "unknown"}`);
  return result.access_token;
}

async function api(name, bearer, method, path, body, headers = {}) {
  const send = (accessToken) => fetch(`${instances[name].base}${path}`, { method,
    headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : {
      "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await send(staffTokens.get(name) ?? bearer);
  if (response.status === 401) {
    const renewed = await token(name, "staff");
    staffTokens.set(name, renewed);
    response = await send(renewed);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${name} ${method} ${path}: HTTP ${response.status} ${JSON.stringify(result).slice(0, 350)}`);
  return result.data;
}
async function until(label, work, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await work();
    if (result) return result;
    await delay(2000);
  }
  throw new Error(`${label} timed out`);
}
async function balance(name, bearer) {
  const { warehouseId, batchId } = instances[name].fixture;
  const rows = await api(name, bearer, "GET",
    `/api/v1/inventory/balances?warehouseId=${warehouseId}&batchId=${batchId}`);
  return Number(rows.find((row) => row.warehouseId === warehouseId && row.batchId === batchId)?.quantity ?? 0);
}
async function markAvailable(name, admin) {
  const id = instances[name].fixture.batchId;
  const batch = await api(name, admin, "GET", `/api/v1/batches/${id}`);
  if (batch.qualityStatus === "available") return;
  await api(name, admin, "POST", `/api/v1/batches/${id}/quality-actions`,
    { action: "mark_available", reason: "Verified local federation demo lot" },
    { "if-match": String(batch.version) });
}
async function createIssue(name, staff, purpose, quantity, sourceLineId, resumeId) {
  const { warehouseId, productVariantId, batchId } = instances[name].fixture;
  const issue = resumeId ? await api(name, staff, "GET", `/api/v1/issues/${resumeId}`) :
    await api(name, staff, "POST", "/api/v1/issues", { purpose, lines: [{
    warehouseId, productVariantId, batchId, uomId, quantity: String(quantity),
    ...(sourceLineId ? { sources: [{ sourceLineId, quantity: String(quantity) }] } : {}),
  }] });
  if (issue.status === "confirmed") return issue.id;
  if (issue.status === "draft") await api(name, staff, "POST", `/api/v1/issues/${issue.id}/submit`, {},
    { "if-match": String(issue.version), "idempotency-key": crypto.randomUUID() });
  else assert.ok(["pending_approval", "approved"].includes(issue.status),
    "Resume issue must await approval or already be approved");
  if (issue.status !== "approved")
    console.log(`APPROVAL_REQUIRED ${name.toUpperCase()} issue=${issue.id} URL=${instances[name].base}/trading/approvals`);
  const approved = await until(`${name} approval synced`, async () => {
    const row = await api(name, staff, "GET", `/api/v1/issues/${issue.id}`);
    return row.status === "approved" ? row : null;
  }, 900);
  await api(name, staff, "POST", `/api/v1/issues/${issue.id}/confirm`, {},
    { "if-match": String(approved.version), "idempotency-key": crypto.randomUUID() });
  return issue.id;
}
async function transfer(name, staff, issueId, recipient) {
  const options = await api(name, staff, "GET", "/api/v1/transfers?options=1");
  const partner = options.partners.find((row) => row.issuerInstanceId === `nexora-${recipient}`);
  assert.ok(partner, `${name} partner ${recipient} missing`);
  const draft = await api(name, staff, "POST", "/api/v1/transfers",
    { linkedIssueId: issueId, destinationPartnerId: partner.id });
  await api(name, staff, "POST", `/api/v1/transfers/${draft.id}/confirm`, {},
    { "if-match": String(draft.version), "idempotency-key": crypto.randomUUID() });
  return draft.id;
}
async function receive(name, staff, transferId, actual, expectedBefore) {
  const notification = await until(`${name} inbound announcement`, async () => {
    const options = await api(name, staff, "GET", "/api/v1/receivings?options=1");
    return options.messages.find((row) => row.sourceDocument.id === transferId);
  });
  assert.equal(await balance(name, staff), expectedBefore, `${name} ACK changed stock`);
  const lot = notification.lots[0];
  assert.equal(notification.lots.length, 1);
  const { batchId, warehouseId } = instances[name].fixture;
  const draft = await api(name, staff, "POST", "/api/v1/receivings", {
    inboundMessageId: notification.messageId,
    actualLines: [{ sourceLineId: lot.sourceLineId, actualQuantity: String(actual),
      localBatchId: batchId, warehouseId, unit: lot.unit }],
    ...(Number(lot.quantity) === actual ? {} : { discrepancyReason: "Physical count below announced quantity" }),
  }, { "idempotency-key": crypto.randomUUID() });
  assert.equal(await balance(name, staff), expectedBefore, `${name} draft changed stock`);
  await api(name, staff, "POST", `/api/v1/receivings/${draft.id}/confirm`, {},
    { "if-match": String(draft.version), "idempotency-key": crypto.randomUUID() });
  assert.equal(await balance(name, staff), expectedBefore + actual, `${name} confirm balance`);
  return { id: draft.id, messageId: notification.messageId, sourceLineId: draft.lines[0].id };
}
async function businessReceipt(name, staff, transferId, actual) {
  return until(`${name} business receipt`, async () => {
    const row = await api(name, staff, "GET", `/api/v1/transfers/${transferId}`);
    return row.businessReceipt ? row : null;
  }).then((row) => {
    assert.equal(Number(row.businessReceipt.actualQuantity), actual);
    assert.equal(row.deliveryState, row.businessReceipt.discrepancyQuantity === "0.000" ? "received" : "partial");
    return row;
  });
}

const users = {};
for (const name of "abc") {
  const ui = await fetch(`${instances[name].base}/trading/approvals`);
  assert.equal(ui.status, 200, `${name} approval UI gateway route`);
  const { env } = instances[name];
  const definitions = await fetch(`http://127.0.0.1:${env.FLOWABLE_HOST_PORT}` +
    "/flowable-rest/service/repository/process-definitions?key=goods-issue-approval&latest=true", {
    headers: { authorization: `Basic ${Buffer.from(`${env.FLOWABLE_ADMIN_USER}:${env.FLOWABLE_ADMIN_PASSWORD}`)
      .toString("base64")}` },
  });
  assert.equal(definitions.status, 200, `${name} Flowable definition query`);
  const body = await definitions.json();
  assert.ok(body.data?.length === 1 && body.data[0].version >= 1,
    `${name} Flowable BPMN missing; run deploy/scripts/deploy-flowable.sh for this instance before the journey`);
}
for (const name of "abc") {
  const staff = await token(name, "staff");
  users[name] = { staff }; staffTokens.set(name, staff);
}
const opening = await Promise.all("abc".split("").map((name) => balance(name, users[name].staff)));
const resumeStage = process.env.DEMO_RESUME_STAGE;
const resuming = resumeStage === "b_approval" || resumeStage === "c_receiving";
assert.ok(!resumeStage || resuming, "Unsupported resume stage");
if (resuming) {
  assert.deepEqual(opening, resumeStage === "b_approval" ? [8, 10, 0] : [8, 4, 0],
    `${resumeStage} checkpoint balances`);
  for (const key of ["DEMO_RESUME_ISSUE_A", "DEMO_RESUME_TRANSFER_AB",
    "DEMO_RESUME_RECEIPT_B", "DEMO_RESUME_ISSUE_B"]) assert.ok(process.env[key], `${key} required`);
  if (resumeStage === "c_receiving") assert.ok(process.env.DEMO_RESUME_TRANSFER_BC,
    "DEMO_RESUME_TRANSFER_BC required");
} else {
  assert.equal(opening[1], 0); assert.equal(opening[2], 0);
  await markAvailable("a", users.a.staff);
  if (opening[0] === 0) {
    const { warehouseId, productVariantId, batchId } = instances.a.fixture;
    const receipt = await api("a", users.a.staff, "POST", "/api/v1/receipts", {
      lines: [{ warehouseId, productVariantId, batchId, uomId, quantity: "20" }],
    });
    await api("a", users.a.staff, "POST", `/api/v1/receipts/${receipt.id}/confirm`, {},
      { "if-match": String(receipt.version), "idempotency-key": crypto.randomUUID() });
    console.log(`OPENING_RECEIPT A id=${receipt.id}`);
  } else assert.equal(opening[0], 20, "A must start with 0 or 20 units");
  assert.equal(await balance("a", users.a.staff), 20);
}
const issueA = resuming ? process.env.DEMO_RESUME_ISSUE_A : await createIssue("a", users.a.staff,
  "partner_transfer", 12, undefined, process.env.DEMO_RESUME_ISSUE_A);
assert.equal(await balance("a", users.a.staff), 8);
const transferAB = resuming ? process.env.DEMO_RESUME_TRANSFER_AB :
  await transfer("a", users.a.staff, issueA, "b");
const receiptB = resuming ? await (async () => {
  const row = await api("b", users.b.staff, "GET", `/api/v1/receivings/${process.env.DEMO_RESUME_RECEIPT_B}`);
  assert.equal(row.status, "confirmed");
  assert.equal(Number(row.actualQuantity), 10);
  return { id: row.id, messageId: row.inboundMessageId, sourceLineId: row.lines[0].id };
})() : await receive("b", users.b.staff, transferAB, 10, 0);
const acceptedAB = await businessReceipt("a", users.a.staff, transferAB, 10);
assert.equal(await balance("a", users.a.staff), 8, "A issue changed after business reply");
await markAvailable("b", users.b.staff);
const issueB = resumeStage === "c_receiving" ? process.env.DEMO_RESUME_ISSUE_B :
  await createIssue("b", users.b.staff, "partner_transfer", 6,
    receiptB.sourceLineId, process.env.DEMO_RESUME_ISSUE_B);
assert.equal(await balance("b", users.b.staff), 4);
const transferBC = resumeStage === "c_receiving" ? process.env.DEMO_RESUME_TRANSFER_BC :
  await transfer("b", users.b.staff, issueB, "c");
const receiptC = await receive("c", users.c.staff, transferBC, 6, 0);
const acceptedBC = await businessReceipt("b", users.b.staff, transferBC, 6);
await markAvailable("c", users.c.staff);
const issueC = await createIssue("c", users.c.staff, "sale", 2,
  receiptC.sourceLineId);
const sale = await api("c", users.c.staff, "POST", "/api/v1/sales-records",
  { linkedIssueId: issueC, buyerRef: "G09 demo buyer" });
await api("c", users.c.staff, "POST", `/api/v1/sales-records/${sale.id}/confirm`, {},
  { "if-match": String(sale.version), "idempotency-key": crypto.randomUUID() });
assert.deepEqual(await Promise.all("abc".split("").map((name) => balance(name, users[name].staff))), [8, 4, 4]);
console.log(JSON.stringify({ result: "PASS", balances: { a: 8, b: 4, c: 4 },
  ids: { issueA, transferAB, inboundB: receiptB.messageId, receiptB: receiptB.id,
    businessAB: acceptedAB.businessReceipt.sourceReceivingId, issueB, transferBC,
    inboundC: receiptC.messageId, receiptC: receiptC.id,
    businessBC: acceptedBC.businessReceipt.sourceReceivingId, issueC, sale: sale.id } }, null, 2));

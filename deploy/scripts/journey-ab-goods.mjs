// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A↔B goods journey (no instance C).
 * Requires DEMO_ONLY=true, seed-abc a+b fixtures, partner connections, Flowable BPMN.
 *
 *   $env:DEMO_ONLY="true"
 *   node deploy/scripts/journey-ab-goods.mjs
 *
 * Optional:
 *   DEMO_PARTIAL_ACTUAL=10   (default 10; opening issue qty 12)
 *   DEMO_SKIP_REVERSE=1      skip B→A leg
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");

const root = resolve(import.meta.dirname, "../..");
const issueQty = Number(process.env.DEMO_ISSUE_QTY ?? 12);
const receiveActual = Number(process.env.DEMO_PARTIAL_ACTUAL ?? 10);
const reverseQty = Number(process.env.DEMO_REVERSE_QTY ?? 4);
const skipReverse = process.env.DEMO_SKIP_REVERSE === "1";
const uomId = "aaaaaaaa-0001-4000-8000-000000000001";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const instances = Object.fromEntries(
  ["a", "b"].map((name) => {
    const env = parseEnv(readFileSync(resolve(root, "deploy/instances", `${name}.env`), "utf8"));
    const fixture = JSON.parse(
      readFileSync(resolve(root, "deploy/instances", name, "fixture-manifest.json"), "utf8"),
    );
    if (env.INSTANCE_ID !== name || fixture.instanceId !== `nexora-${name}`) {
      throw new Error(`Demo instance identity mismatch: ${name}`);
    }
    const base = (env.PUBLIC_BASE_URL || `http://127.0.0.1:${env.GATEWAY_HTTP_PORT}`).replace(
      /\/$/,
      "",
    );
    return [name, { env, fixture, base }];
  }),
);

const staffTokens = new Map();

async function token(name, role) {
  const { env } = instances[name];
  const account =
    role === "approver"
      ? [env.KC_APPROVER_USERNAME, env.KC_APPROVER_PASSWORD]
      : [env.KC_DEV_USERNAME, env.KC_DEV_USER_PASSWORD];
  assert.ok(account[0] && account[1], `${name} ${role} account missing`);
  const response = await fetch(
    `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}/realms/nexora/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "erp-browser",
        username: account[0],
        password: account[1],
      }),
    },
  );
  const result = await response.json();
  assert.equal(
    response.status,
    200,
    `${name} ${role} token HTTP ${response.status}: ${result.error ?? result.error_description ?? "unknown"}`,
  );
  return result.access_token;
}

async function api(name, bearer, method, path, body, headers = {}) {
  const send = (accessToken) =>
    fetch(`${instances[name].base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  let response = await send(staffTokens.get(name) ?? bearer);
  if (response.status === 401) {
    const renewed = await token(name, "staff");
    staffTokens.set(name, renewed);
    response = await send(renewed);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${name} ${method} ${path}: HTTP ${response.status} ${JSON.stringify(result).slice(0, 350)}`,
    );
  }
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
  const rows = await api(
    name,
    bearer,
    "GET",
    `/api/v1/inventory/balances?warehouseId=${warehouseId}&batchId=${batchId}`,
  );
  return Number(
    rows.find((row) => row.warehouseId === warehouseId && row.batchId === batchId)?.quantity ?? 0,
  );
}

async function markAvailable(name, admin) {
  const id = instances[name].fixture.batchId;
  const batch = await api(name, admin, "GET", `/api/v1/batches/${id}`);
  if (batch.qualityStatus === "available") return;
  await api(
    name,
    admin,
    "POST",
    `/api/v1/batches/${id}/quality-actions`,
    { action: "mark_available", reason: "Verified local AB goods demo lot" },
    { "if-match": String(batch.version) },
  );
}

async function createIssue(name, staff, purpose, quantity, sourceLineId) {
  const { warehouseId, productVariantId, batchId } = instances[name].fixture;
  const issue = await api(name, staff, "POST", "/api/v1/issues", {
    purpose,
    lines: [
      {
        warehouseId,
        productVariantId,
        batchId,
        uomId,
        quantity: String(quantity),
        ...(sourceLineId ? { sources: [{ sourceLineId, quantity: String(quantity) }] } : {}),
      },
    ],
  });
  if (issue.status === "draft") {
    await api(
      name,
      staff,
      "POST",
      `/api/v1/issues/${issue.id}/submit`,
      {},
      { "if-match": String(issue.version), "idempotency-key": crypto.randomUUID() },
    );
  }
  console.log(
    `APPROVAL_REQUIRED ${name.toUpperCase()} issue=${issue.id} → ${instances[name].base}/trading/approvals`,
  );
  const approved = await until(`${name} approval synced`, async () => {
    const row = await api(name, staff, "GET", `/api/v1/issues/${issue.id}`);
    return row.status === "approved" ? row : null;
  }, 900);
  await api(
    name,
    staff,
    "POST",
    `/api/v1/issues/${issue.id}/confirm`,
    {},
    { "if-match": String(approved.version), "idempotency-key": crypto.randomUUID() },
  );
  return issue.id;
}

async function transfer(name, staff, issueId, recipient) {
  const options = await api(name, staff, "GET", "/api/v1/transfers?options=1");
  const partner = options.partners.find((row) => row.issuerInstanceId === `nexora-${recipient}`);
  assert.ok(partner, `${name} partner ${recipient} missing — run configure-abc-federation / UI link`);
  const draft = await api(name, staff, "POST", "/api/v1/transfers", {
    linkedIssueId: issueId,
    destinationPartnerId: partner.id,
  });
  await api(
    name,
    staff,
    "POST",
    `/api/v1/transfers/${draft.id}/confirm`,
    {},
    { "if-match": String(draft.version), "idempotency-key": crypto.randomUUID() },
  );
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
  const draft = await api(
    name,
    staff,
    "POST",
    "/api/v1/receivings",
    {
      inboundMessageId: notification.messageId,
      actualLines: [
        {
          sourceLineId: lot.sourceLineId,
          actualQuantity: String(actual),
          localBatchId: batchId,
          warehouseId,
          unit: lot.unit,
        },
      ],
      ...(Number(lot.quantity) === actual
        ? {}
        : { discrepancyReason: "Physical count below announced quantity" }),
    },
    { "idempotency-key": crypto.randomUUID() },
  );
  await api(
    name,
    staff,
    "POST",
    `/api/v1/receivings/${draft.id}/confirm`,
    {},
    { "if-match": String(draft.version), "idempotency-key": crypto.randomUUID() },
  );
  assert.equal(await balance(name, staff), expectedBefore + actual, `${name} confirm balance`);
  return { id: draft.id, messageId: notification.messageId, sourceLineId: draft.lines[0].id };
}

async function businessReceipt(name, staff, transferId, actual) {
  return until(`${name} business receipt`, async () => {
    const row = await api(name, staff, "GET", `/api/v1/transfers/${transferId}`);
    return row.businessReceipt ? row : null;
  }).then((row) => {
    assert.equal(Number(row.businessReceipt.actualQuantity), actual);
    return row;
  });
}

for (const name of ["a", "b"]) {
  const { env } = instances[name];
  const definitions = await fetch(
    `http://127.0.0.1:${env.FLOWABLE_HOST_PORT}/flowable-rest/service/repository/process-definitions?key=goods-issue-approval&latest=true`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`${env.FLOWABLE_ADMIN_USER}:${env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64")}`,
      },
    },
  );
  assert.equal(definitions.status, 200, `${name} Flowable definition query`);
  const body = await definitions.json();
  assert.ok(
    body.data?.length === 1 && body.data[0].version >= 1,
    `${name} Flowable BPMN missing; run deploy/scripts/deploy-flowable.sh`,
  );
}

const users = {};
for (const name of ["a", "b"]) {
  const staff = await token(name, "staff");
  users[name] = { staff };
  staffTokens.set(name, staff);
}

let balA = await balance("a", users.a.staff);
const balB0 = await balance("b", users.b.staff);
await markAvailable("a", users.a.staff);

if (balA === 0) {
  const { warehouseId, productVariantId, batchId } = instances.a.fixture;
  const receipt = await api("a", users.a.staff, "POST", "/api/v1/receipts", {
    lines: [{ warehouseId, productVariantId, batchId, uomId, quantity: String(Math.max(issueQty, 20)) }],
  });
  await api(
    "a",
    users.a.staff,
    "POST",
    `/api/v1/receipts/${receipt.id}/confirm`,
    {},
    { "if-match": String(receipt.version), "idempotency-key": crypto.randomUUID() },
  );
  balA = await balance("a", users.a.staff);
  console.log(`OPENING_RECEIPT A bal=${balA}`);
}

assert.ok(balA >= issueQty, `A needs >= ${issueQty} stock (have ${balA})`);
assert.equal(balB0, await balance("b", users.b.staff));

const issueA = await createIssue("a", users.a.staff, "partner_transfer", issueQty);
assert.equal(await balance("a", users.a.staff), balA - issueQty);
const transferAB = await transfer("a", users.a.staff, issueA, "b");
const receiptB = await receive("b", users.b.staff, transferAB, receiveActual, balB0);
await businessReceipt("a", users.a.staff, transferAB, receiveActual);

const afterAB = {
  a: await balance("a", users.a.staff),
  b: await balance("b", users.b.staff),
};
assert.equal(afterAB.a, balA - issueQty);
assert.equal(afterAB.b, balB0 + receiveActual);

let reverse = null;
if (!skipReverse && afterAB.b >= reverseQty) {
  await markAvailable("b", users.b.staff);
  const issueB = await createIssue(
    "b",
    users.b.staff,
    "partner_transfer",
    reverseQty,
    receiptB.sourceLineId,
  );
  const transferBA = await transfer("b", users.b.staff, issueB, "a");
  const receiptA = await receive(
    "a",
    users.a.staff,
    transferBA,
    reverseQty,
    afterAB.a,
  );
  await businessReceipt("b", users.b.staff, transferBA, reverseQty);
  reverse = { issueB, transferBA, receiptA: receiptA.id };
}

const finalBal = {
  a: await balance("a", users.a.staff),
  b: await balance("b", users.b.staff),
};

console.log(
  JSON.stringify(
    {
      result: "PASS",
      scenario: "ab-goods",
      balances: finalBal,
      ids: { issueA, transferAB, receiptB: receiptB.id, inboundB: receiptB.messageId, reverse },
    },
    null,
    2,
  ),
);

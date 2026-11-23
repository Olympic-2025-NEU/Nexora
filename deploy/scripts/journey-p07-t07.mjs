// SPDX-License-Identifier: AGPL-3.0-only
// Run inside instance Docker network with distinct creator/approver accounts and seeded stock.
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const gateway = process.env.P07_GATEWAY_URL ?? "http://gateway:9080";
const keycloak = process.env.P07_KEYCLOAK_URL ?? "http://keycloak:8080";
const warehouseId = required("P07_WAREHOUSE_ID");
const productVariantId = required("P07_VARIANT_ID");
const batchId = required("P07_BATCH_ID");
const uomId = required("P07_UOM_ID");
const ownApprovalId = required("P07_SELF_APPROVAL_ID");

async function token(prefix) {
  const response = await fetch(`${keycloak}/realms/nexora/protocol/openid-connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "erp-browser",
      username: required(`${prefix}_USER`), password: required(`${prefix}_PASSWORD`) }),
  });
  if (!response.ok) throw new Error(`${prefix} token HTTP ${response.status}`);
  const result = await response.json();
  if (!result.access_token) throw new Error(`${prefix} token unavailable`);
  return result.access_token;
}

async function api(accessToken, method, path, body, headers = {}) {
  const response = await fetch(`${gateway}${path}`, { method, headers: {
    authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}), ...headers,
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  return { status: response.status, data: result.data, error: result.error };
}
function expect(result, status, step) {
  if (result.status !== status) throw new Error(`${step}: HTTP ${result.status} ${result.error ?? ""}`);
  console.log(`${step}: HTTP ${status}`);
  return result.data;
}
async function waitFor(work, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await work();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${label}: timeout after 120 seconds`);
}
async function balance(accessToken) {
  const rows = expect(await api(accessToken, "GET", `/api/v1/inventory/balances?warehouseId=${warehouseId}&batchId=${batchId}`),
    200, "balance read");
  const item = rows.find((row) => row.warehouseId === warehouseId && row.batchId === batchId);
  if (!item) throw new Error("Seed stock missing");
  return Number(item.quantity);
}

const creator = await token("P07_CREATOR");
const approver = await token("P07_APPROVER");
const before = await balance(creator);
if (before < 1) throw new Error("Seed stock below 1 unit");
const issue = expect(await api(creator, "POST", "/api/v1/issues", {
  purpose: "other", lines: [{ warehouseId, productVariantId, batchId, uomId, quantity: "1" }],
}), 201, "creator creates issue");
expect(await api(creator, "POST", `/api/v1/issues/${issue.id}/submit`, {}, {
  "if-match": String(issue.version), "idempotency-key": crypto.randomUUID(),
}), 200, "creator submits");
const approval = await waitFor(async () => {
  const inbox = expect(await api(approver, "GET", "/api/v1/approvals/inbox"), 200, "approver inbox");
  return inbox.find((task) => task.documentId === issue.id);
}, "inbox task");
expect(await api(approver, "POST", `/api/v1/approvals/${ownApprovalId}/decisions`,
  { decision: "approve" }, { "idempotency-key": crypto.randomUUID() }), 403, "self-approval blocked");
const intent = expect(await api(approver, "POST", `/api/v1/approvals/${approval.approvalRequestId}/decisions`,
  { decision: "approve" }, { "idempotency-key": crypto.randomUUID() }), 202, "decision intent");
if (intent.state !== "decision_pending") throw new Error("Decision response claimed final result");
if (await balance(creator) !== before) throw new Error("Stock changed before confirm");
const approved = await waitFor(async () => {
  const detail = expect(await api(creator, "GET", `/api/v1/issues/${issue.id}`), 200, "issue poll");
  return detail.status === "approved" && detail.approval?.state === "approved" ? detail : null;
}, "decision sync");
console.log("document + bridge approved; stock unchanged");
expect(await api(creator, "POST", `/api/v1/issues/${issue.id}/confirm`, {}, {
  "if-match": String(approved.version), "idempotency-key": crypto.randomUUID(),
}), 200, "creator confirms");
if (await balance(creator) !== before - 1) throw new Error("Stock did not decrease exactly once on confirm");
console.log("AC-12 gateway journey: PASS; balance moved only at confirm");

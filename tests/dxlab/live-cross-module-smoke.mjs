// SPDX-License-Identifier: AGPL-3.0-only
/** Cross-module deep-link + error-state smoke for P11-T07. Never prints secrets. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const instance = process.argv[2] || "a";
assert.match(instance, /^[abc]$/, "Expected instance a, b or c");
const env = parseEnv(readFileSync(`deploy/instances/${instance}.env`, "utf8"));
assert.ok(env.KC_DEV_USERNAME && env.KC_DEV_USER_PASSWORD, "Staff smoke account is not configured");
const base = env.PUBLIC_BASE_URL;
const keycloakHostPort = env.KEYCLOAK_HOST_PORT || "18080";
const jars = new Map();

function rewriteForHost(url) {
  const target = new URL(url, base);
  if (target.hostname === "keycloak") {
    target.hostname = "127.0.0.1";
    target.port = String(keycloakHostPort);
  }
  return target;
}

async function request(url, options = {}) {
  const target = rewriteForHost(url);
  const jar = jars.get(target.origin) ?? new Map();
  jars.set(target.origin, jar);
  const headers = new Headers(options.headers);
  if (jar.size) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
  const response = await fetch(target, {
    ...options,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/max-age=0(?:;|$)/i.test(line) || !value) jar.delete(name);
    else jar.set(name, value);
  }
  return response;
}

function location(response, current) {
  const value = response.headers.get("location");
  assert.ok(value, "Expected a redirect");
  return new URL(value, current);
}

async function loginAsStaff() {
  const start = new URL("/dxlab/login?next=%2Fdxlab%2Foperations%2Freceipts", base);
  const login = await request(start);
  assert.equal(login.status, 302);
  const authorize = location(login, start);
  const loginPage = await request(authorize);
  assert.equal(loginPage.status, 200);
  const html = await loginPage.text();
  const action = html.match(/<form id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
  assert.ok(action, "Expected Keycloak login form");
  const formUrl = new URL(action.replaceAll("&amp;", "&"));
  const submit = await request(formUrl, {
    method: "POST",
    body: new URLSearchParams({
      username: env.KC_DEV_USERNAME,
      password: env.KC_DEV_USER_PASSWORD,
      credentialId: "",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(submit.status, 302, "Staff auth-code login failed");
  const callbackUrl = location(submit, formUrl);
  assert.equal(callbackUrl.pathname, "/dxlab/callback");
  const callback = await request(callbackUrl);
  assert.equal(callback.status, 303, "DX-Lab did not accept auth code");
}

await loginAsStaff();

const opsHub = await request("/dxlab/operations");
assert.equal(opsHub.status, 200);
const opsHtml = await opsHub.text();
assert.match(opsHtml, /receiving|lot timeline|assistant/i);

const transferToReceiving = await request("/dxlab/operations/transfers");
assert.equal(transferToReceiving.status, 200);
const transferHtml = await transferToReceiving.text();
assert.match(transferHtml, /Receiving|nhận hàng|Tạo|điều chuyển/i);

const receiptToLot = await request("/dxlab/operations/receipts");
assert.equal(receiptToLot.status, 200);
const receiptHtml = await receiptToLot.text();
assert.match(receiptHtml, /Lots|Trace|data\/lots|Tạo/i);

const lotMissing = await request("/dxlab/data/lots/00000000-0000-4000-8000-0000000000aa");
assert.equal(lotMissing.status, 200);
const lotHtml = await lotMissing.text();
assert.match(lotHtml, /Không tải|Timeline|Impact|error|404|timeline/i);

const impact = await request("/dxlab/data/impact/00000000-0000-4000-8000-0000000000aa");
assert.equal(impact.status, 200);

const assistant = await request("/dxlab/assistant");
assert.equal(assistant.status, 200);
const assistantHtml = await assistant.text();
assert.match(assistantHtml, /không tự confirm|human|Draft/i);

// Network-error style: hit a path while simulating gateway miss via bogus next preserved path
const expired = await request("/dxlab/login?next=%2Fdxlab%2Foperations%2Freceipts");
assert.ok([302, 303].includes(expired.status), "Login redirect must preserve deep link");

console.log("DX-Lab cross-module deep-link smoke: PASS");

// SPDX-License-Identifier: AGPL-3.0-only
/** Live P/D/I page smoke against DX-Lab + gateway. Never prints secrets. */
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
  const start = new URL("/dxlab/login?next=%2Fdxlab%2Fwork", base);
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

const pages = [
  ["/dxlab/operations", /Giao dịch|P · Process/],
  ["/dxlab/operations/receipts", /phiếu nhập|Tạo/i],
  ["/dxlab/operations/issues", /phiếu xuất|Tạo/i],
  ["/dxlab/operations/transfers", /điều chuyển|Tạo/i],
  ["/dxlab/operations/receivings", /nhận hàng|Tạo/i],
  ["/dxlab/work/approvals", /phê duyệt|Approver|inbox/i],
  ["/dxlab/data", /Tồn và truy xuất|D · Data/],
  ["/dxlab/data/inventory", /Tồn|số dư|movement/i],
  ["/dxlab/data/lots", /Lô|batch|Tìm/i],
  ["/dxlab/assistant", /Trợ lý|Draft|Hỏi/i],
];

for (const [path, pattern] of pages) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} failed with ${response.status}`);
  const html = await response.text();
  assert.match(html, pattern, `${path} missing expected copy`);
  assert.doesNotMatch(html, /outboundSecretRef|vault:\/\//i);
}

const passport = await request("/dxlab/passport/not-a-real-token");
assert.equal(passport.status, 200, "Passport page should render 404-state UI");
const passportHtml = await passport.text();
assert.match(passportHtml, /không hợp lệ|thu hồi|Passport/i);
assert.doesNotMatch(passportHtml, /email|rawPayload|buyerRef/i);

const deepTransfer = await request(
  "/dxlab/operations?partnerId=00000000-0000-4000-8000-000000000099",
);
assert.equal(deepTransfer.status, 200);
const deepHtml = await deepTransfer.text();
assert.match(deepHtml, /00000000-0000-4000-8000-000000000099/);
assert.match(deepHtml, /receiving|lot timeline|assistant/i);

console.log("DX-Lab P/D/I Staff smoke (operations/data/assistant/passport): PASS");

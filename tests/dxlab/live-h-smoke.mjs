// SPDX-License-Identifier: AGPL-3.0-only
/** Local H-journey smoke: Staff vs Admin page guards and partner handoff. Never prints secrets. */
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
    signal: AbortSignal.timeout(15000),
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

const work = await request("/dxlab/work");
assert.equal(work.status, 200, "Staff work page failed");
const workHtml = await work.text();
assert.match(workHtml, /Công việc của tôi/);
assert.match(workHtml, /Tổ chức phiên hiện tại/);
assert.doesNotMatch(workHtml, /outboundSecretRef/i);

const profile = await request("/dxlab/profile");
assert.equal(profile.status, 200, "Staff profile page failed");
const profileHtml = await profile.text();
assert.match(profileHtml, /Hồ sơ/);
assert.match(profileHtml, /organizationId|Tổ chức/);
assert.doesNotMatch(profileHtml, /outboundSecretRef/i);

const partners = await request("/dxlab/partners");
assert.equal(partners.status, 200, "Staff partners page failed");
const partnersHtml = await partners.text();
assert.match(partnersHtml, /Đối tác|đối tác/i);
assert.doesNotMatch(partnersHtml, /outboundSecretRef/i);
assert.doesNotMatch(partnersHtml, /vault:\/\//i);

const members = await request("/dxlab/members");
assert.ok([403, 404].includes(members.status) ||
  (members.status === 200 && /Không có quyền truy cập|Forbidden/i.test(await members.text())),
  "Staff must not manage members");

const handoff = await request("/dxlab/operations?partnerId=00000000-0000-4000-8000-000000000099");
assert.equal(handoff.status, 200, "Partner handoff operations page failed");
const handoffHtml = await handoff.text();
assert.match(handoffHtml, /00000000-0000-4000-8000-000000000099/);
assert.match(handoffHtml, /destinationPartnerId|partnerId/);

console.log("DX-Lab H journey Staff smoke (work/profile/partners/members-guard/handoff): PASS");

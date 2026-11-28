// SPDX-License-Identifier: AGPL-3.0-only
/** Safe, anonymous gateway probe; never prints cookies, codes or tokens. */
import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:19080";
const request = (path, init) => fetch(new URL(path, base), { redirect: "manual", ...init,
  signal: AbortSignal.timeout(10000) });

const health = await request("/dxlab/api/health");
assert.equal(health.status, 200);
const home = await request("/dxlab");
assert.equal(home.status, 200);
const session = await request("/dxlab/api/session");
assert.equal(session.status, 401);
assert.equal((await session.json()).code, "SESSION_EXPIRED");
const protectedPage = await request("/dxlab/work?tab=mine");
assert.ok([302, 303, 307, 308].includes(protectedPage.status));
const destination = new URL(protectedPage.headers.get("location"), base);
assert.equal(destination.pathname, "/dxlab/sign-in");
assert.equal(destination.searchParams.get("next"), "/dxlab/work?tab=mine");
const login = await request("/dxlab/login?next=%2F%2Fevil.test");
assert.ok([302, 303].includes(login.status));
const authorization = new URL(login.headers.get("location"));
assert.equal(authorization.pathname, "/realms/nexora/protocol/openid-connect/auth");
assert.equal(authorization.searchParams.get("response_type"), "code");
assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
assert.ok(authorization.searchParams.has("state"));
assert.ok(authorization.searchParams.has("code_challenge"));
const pkceCookie = login.headers.get("set-cookie") || "";
assert.match(pkceCookie, /nexora_dxlab_pkce=/);
assert.match(pkceCookie, /HttpOnly/i);
assert.match(pkceCookie, /SameSite=Lax/i);
assert.match(pkceCookie, /Path=\/dxlab/i);
const forgedCallback = await request("/dxlab/callback?code=forged&state=forged");
assert.equal(forgedCallback.status, 401);
const expired = await request("/dxlab/session/refresh?next=%2Fdxlab%2Fwork");
assert.equal(expired.status, 303);
const expiredDestination = new URL(expired.headers.get("location"), base);
assert.equal(expiredDestination.pathname, "/dxlab/sign-in");
assert.equal(expiredDestination.searchParams.get("reason"), "expired");
assert.equal(expiredDestination.searchParams.get("next"), "/dxlab/work");
const csrf = await request("/dxlab/logout", { method: "POST",
  headers: { origin: "https://evil.test" } });
assert.equal(csrf.status, 403);
const logout = await request("/dxlab/logout", { method: "POST",
  headers: { origin: new URL(base).origin } });
assert.equal(logout.status, 303);
const logoutUrl = new URL(logout.headers.get("location"));
assert.equal(logoutUrl.pathname, "/realms/nexora/protocol/openid-connect/logout");
assert.equal(logoutUrl.searchParams.get("post_logout_redirect_uri"), new URL("/dxlab", base).href);
const keycloak = await fetch(logoutUrl, { redirect: "manual", signal: AbortSignal.timeout(10000) });
assert.equal(keycloak.status, 302);
assert.equal(keycloak.headers.get("location"), new URL("/dxlab", base).href);
console.log("DX-Lab gateway: health/home 200; anonymous session 401; safe deep link; PKCE + HttpOnly cookie; forged callback 401; expired session prompt; CSRF 403; logout redirect accepted");

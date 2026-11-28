// SPDX-License-Identifier: AGPL-3.0-only
/** Local-only auth-code and refresh smoke. Never prints credentials, codes or cookies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const instance = process.argv[2] || 'a';
assert.match(instance, /^[abc]$/, 'Expected instance a, b or c');
const env = parseEnv(readFileSync(`deploy/instances/${instance}.env`, 'utf8'));
assert.ok(env.KC_DEV_USERNAME && env.KC_DEV_USER_PASSWORD, 'Staff smoke account is not configured');
const base = env.PUBLIC_BASE_URL;
const keycloakHostPort = env.KEYCLOAK_HOST_PORT || '18080';
const jars = new Map();
function rewriteForHost(url) {
  const target = new URL(url, base);
  if (target.hostname === 'keycloak') {
    target.hostname = '127.0.0.1';
    target.port = String(keycloakHostPort);
  }
  return target;
}
async function request(url, options = {}) {
  const target = rewriteForHost(url);
  const jar = jars.get(target.origin) ?? new Map();
  jars.set(target.origin, jar);
  const headers = new Headers(options.headers);
  if (jar.size) headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
  const response = await fetch(target, { ...options, headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/max-age=0(?:;|$)/i.test(line) || !value) jar.delete(name);
    else jar.set(name, value);
  }
  return response;
}
function location(response, current) {
  const value = response.headers.get('location');
  assert.ok(value, 'Expected a redirect');
  return new URL(value, current);
}

const start = new URL('/dxlab/login?next=%2Fdxlab%2Fwork', base);
const login = await request(start);
assert.equal(login.status, 302);
const authorize = location(login, start);
const loginPage = await request(authorize);
assert.equal(loginPage.status, 200);
const html = await loginPage.text();
const action = html.match(/<form id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
assert.ok(action, 'Expected Keycloak login form');
const formUrl = new URL(action.replaceAll('&amp;', '&'));
const submit = await request(formUrl, { method: 'POST',
  body: new URLSearchParams({ username: env.KC_DEV_USERNAME,
    password: env.KC_DEV_USER_PASSWORD, credentialId: '' }),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assert.equal(submit.status, 302, 'Staff auth-code login failed');
const callbackUrl = location(submit, formUrl);
assert.equal(callbackUrl.pathname, '/dxlab/callback', 'Keycloak did not return an auth code');
const callback = await request(callbackUrl);
assert.equal(callback.status, 303, 'DX-Lab did not accept auth code');
const firstWork = await request('/dxlab/work');
assert.equal(firstWork.status, 200, 'Authenticated work page failed');
const browserJar = jars.get(new URL(base).origin);
assert.ok(browserJar.has('nexora_dxlab_access') && browserJar.has('nexora_dxlab_refresh'));
browserJar.delete('nexora_dxlab_access');
const missingAccess = await request('/dxlab/work');
assert.ok([302, 303, 307, 308].includes(missingAccess.status));
const refreshUrl = location(missingAccess, new URL('/dxlab/work', base));
assert.equal(refreshUrl.pathname, '/dxlab/session/refresh');
const refresh = await request(refreshUrl);
assert.equal(refresh.status, 303, 'Session refresh failed');
assert.equal(location(refresh, refreshUrl).pathname, '/dxlab/work');
assert.ok(browserJar.has('nexora_dxlab_access'), 'Refreshed access cookie missing');
const secondWork = await request('/dxlab/work');
assert.equal(secondWork.status, 200, 'Refreshed work page failed');
console.log('DX-Lab real Staff auth-code login, protected work, refresh-token rotation and return to work: PASS');

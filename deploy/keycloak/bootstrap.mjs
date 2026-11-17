// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};

const base = 'http://keycloak:8080';
const realm = JSON.parse(readFileSync('/bootstrap/realm-template.json', 'utf8'));
const issuer = new URL(required('OIDC_ISSUER_URL'));
if (issuer.href.replace(/\/$/, '') !== `${required('OIDC_BASE_URL')}/realms/${realm.realm}`) {
  throw new Error('OIDC_ISSUER_URL must match OIDC_BASE_URL and realm');
}
for (const [client, idVar, redirectVar] of [
  [realm.clients[0], 'OIDC_CLIENT_ID_ERP', 'OIDC_REDIRECT_URI_ERP'],
  [realm.clients[1], 'OIDC_CLIENT_ID_DXLAB', 'OIDC_REDIRECT_URI_DXLAB'],
]) {
  client.clientId = required(idVar);
  const redirect = new URL(required(redirectVar));
  if (!['http:', 'https:'].includes(redirect.protocol)) throw new Error(`Invalid ${redirectVar}`);
  client.redirectUris = [redirect.href];
  client.webOrigins = [redirect.origin];
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 || response.status === 201 ? null : response.json();
}

async function main() {
  let token;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: required('KC_BOOTSTRAP_ADMIN_USERNAME'), password: required('KC_BOOTSTRAP_ADMIN_PASSWORD') }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Admin token: HTTP ${response.status}`);
      token = (await response.json()).access_token;
      break;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  const existing = await request(`/admin/realms/${realm.realm}`, token).catch((error) => {
    if (error.message.endsWith('HTTP 404')) return null;
    throw error;
  });
  if (!existing) {
    await request('/admin/realms', token, 'POST', realm);
  } else {
    for (const client of realm.clients) {
      const found = await request(`/admin/realms/${realm.realm}/clients?clientId=${encodeURIComponent(client.clientId)}`, token);
      if (found.length) await request(`/admin/realms/${realm.realm}/clients/${found[0].id}`, token, 'PUT', { ...found[0], ...client });
      else await request(`/admin/realms/${realm.realm}/clients`, token, 'POST', client);
    }
  }
  if (process.env.KC_DEV_USER_PASSWORD) {
    const username = required('KC_DEV_USERNAME');
    const users = await request(`/admin/realms/${realm.realm}/users?username=${encodeURIComponent(username)}&exact=true`, token);
    if (!users.length) await request(`/admin/realms/${realm.realm}/users`, token, 'POST', {
      username, enabled: true,
      credentials: [{ type: 'password', value: process.env.KC_DEV_USER_PASSWORD, temporary: true }],
    });
    const userId = users[0]?.id ?? (await request(`/admin/realms/${realm.realm}/users?username=${encodeURIComponent(username)}&exact=true`, token))[0].id;
    const role = await request(`/admin/realms/${realm.realm}/roles/staff`, token);
    const assigned = await request(`/admin/realms/${realm.realm}/users/${userId}/role-mappings/realm`, token);
    if (!assigned.some((item) => item.id === role.id)) {
      await request(`/admin/realms/${realm.realm}/users/${userId}/role-mappings/realm`, token, 'POST', [role]);
    }
  }
  console.log(`Keycloak realm ${realm.realm}: clients and optional dev user ready`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

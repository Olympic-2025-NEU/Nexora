// SPDX-License-Identifier: AGPL-3.0-only
// P02-T01: Bootstrap Keycloak realm, clients, optional boot users.
// - Staff user: no MFA required action.
// - Administrator user (KC_ADMIN_USERNAME / KC_ADMIN_PASSWORD env): CONFIGURE_TOTP assigned.
// - Approver user (KC_APPROVER_USERNAME / KC_APPROVER_PASSWORD env): CONFIGURE_TOTP assigned.
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
// Local smoke uses Resource-Owner password grant against erp-browser (G02 curl matrix).
// Browser production path remains auth-code + PKCE; do not expose ROPC on public internet demos.
const erpClient = realm.clients.find((c) => c.clientId === process.env.OIDC_CLIENT_ID_ERP) ?? realm.clients[0];
erpClient.directAccessGrantsEnabled = true;

const gatewayClient = realm.clients.find((c) => c.clientId === 'gateway-oidc' || c.clientId === process.env.OIDC_GATEWAY_CLIENT_ID);
if (gatewayClient) {
  if (process.env.OIDC_GATEWAY_CLIENT_ID) gatewayClient.clientId = process.env.OIDC_GATEWAY_CLIENT_ID;
  gatewayClient.secret = required('OIDC_GATEWAY_CLIENT_SECRET');
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

/** Ensure a realm user exists; return their Keycloak user id. */
async function ensureUser(token, username, password, { temporary = true } = {}) {
  const existing = await request(
    `/admin/realms/${realm.realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    token,
  );
  if (!existing.length) {
    await request(`/admin/realms/${realm.realm}/users`, token, 'POST', {
      username,
      enabled: true,
      credentials: [{ type: 'password', value: password, temporary }],
    });
  }
  const users = await request(
    `/admin/realms/${realm.realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    token,
  );
  return users[0].id;
}

/** Assign a realm role to a user (idempotent). */
async function assignRole(token, userId, roleName) {
  const role = await request(`/admin/realms/${realm.realm}/roles/${roleName}`, token);
  const assigned = await request(
    `/admin/realms/${realm.realm}/users/${userId}/role-mappings/realm`,
    token,
  );
  if (!assigned.some((r) => r.id === role.id)) {
    await request(
      `/admin/realms/${realm.realm}/users/${userId}/role-mappings/realm`,
      token,
      'POST',
      [role],
    );
  }
}

/**
 * Assign CONFIGURE_TOTP required action (MFA) to a user.
 * Required for administrator and approver roles per security.md / ADR 0004.
 */
async function assignMfaRequiredAction(token, userId) {
  const user = await request(`/admin/realms/${realm.realm}/users/${userId}`, token);
  const existing = user.requiredActions ?? [];
  if (!existing.includes('CONFIGURE_TOTP')) {
    await request(`/admin/realms/${realm.realm}/users/${userId}`, token, 'PUT', {
      ...user,
      requiredActions: [...existing, 'CONFIGURE_TOTP'],
    });
  }
}

async function main() {
  let changes = 0;
  let token;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: required('KC_BOOTSTRAP_ADMIN_USERNAME'),
          password: required('KC_BOOTSTRAP_ADMIN_PASSWORD'),
        }),
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
    changes++;
  } else {
    for (const client of realm.clients) {
      const found = await request(
        `/admin/realms/${realm.realm}/clients?clientId=${encodeURIComponent(client.clientId)}`,
        token,
      );
      if (found.length) {
        const current = await request(
          `/admin/realms/${realm.realm}/clients/${found[0].id}`,
          token,
        );
        const changed = Object.entries(client).some(([key, value]) =>
          JSON.stringify(
            key === 'attributes'
              ? Object.fromEntries(
                  Object.keys(value).map((name) => [name, current.attributes?.[name]]),
                )
              : current[key],
          ) !== JSON.stringify(value),
        );
        if (changed) {
          await request(
            `/admin/realms/${realm.realm}/clients/${current.id}`,
            token,
            'PUT',
            { ...current, ...client },
          );
          changes++;
        }
      } else {
        await request(`/admin/realms/${realm.realm}/clients`, token, 'POST', client);
        changes++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Optional dev staff user (KC_DEV_USER_PASSWORD) — no MFA required.
  // -------------------------------------------------------------------------
  if (process.env.KC_DEV_USER_PASSWORD) {
    const username = required('KC_DEV_USERNAME');
    // temporary=false so local smoke can use Resource-Owner password grant (G02 matrix).
    const userId = await ensureUser(token, username, process.env.KC_DEV_USER_PASSWORD, {
      temporary: false,
    });
    await assignRole(token, userId, 'staff');
    changes++;
  }

  // -------------------------------------------------------------------------
  // Optional admin boot user (KC_ADMIN_USERNAME / KC_ADMIN_PASSWORD) — MFA required.
  // -------------------------------------------------------------------------
  if (process.env.KC_ADMIN_PASSWORD) {
    const username = required('KC_ADMIN_USERNAME');
    const userId = await ensureUser(token, username, process.env.KC_ADMIN_PASSWORD);
    await assignRole(token, userId, 'administrator');
    await assignMfaRequiredAction(token, userId);
    changes++;
  }

  // -------------------------------------------------------------------------
  // Optional approver boot user (KC_APPROVER_USERNAME / KC_APPROVER_PASSWORD) — MFA required.
  // -------------------------------------------------------------------------
  if (process.env.KC_APPROVER_PASSWORD) {
    const username = required('KC_APPROVER_USERNAME');
    const userId = await ensureUser(token, username, process.env.KC_APPROVER_PASSWORD);
    await assignRole(token, userId, 'approver');
    await assignMfaRequiredAction(token, userId);
    changes++;
  }

  console.log(
    `Keycloak realm ${realm.realm}: clients and optional boot users ready; changes=${changes}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

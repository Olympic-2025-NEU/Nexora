// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-only: clear CONFIGURE_TOTP + set non-temporary passwords for demo users
 * so /auth/dev-token password grant works without an OTP enrollment step.
 *
 * Usage (from repo root, host-side Keycloak port):
 *   node --env-file=deploy/instances/b.env deploy/scripts/fix-local-demo-users.mjs
 *
 * Requires DEMO_ONLY=true. Never use against non-demo realms.
 */
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DEMO_ONLY !== "true") {
  console.error("DEMO_ONLY=true required");
  process.exit(1);
}

const envFile = process.argv[2];
const env = envFile
  ? parseEnv(readFileSync(resolve(envFile), "utf8"))
  : process.env;

const hostPort = env.KEYCLOAK_HOST_PORT || "18080";
const base = `http://127.0.0.1:${hostPort}`;
const realm = "nexora";

async function adminToken() {
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: env.KC_BOOTSTRAP_ADMIN_USERNAME,
      password: env.KC_BOOTSTRAP_ADMIN_PASSWORD,
    }),
  });
  const json = await response.json();
  if (!json.access_token) throw new Error(`admin token failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function findUser(token, username) {
  const list = await fetch(
    `${base}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  if (!list.length) throw new Error(`user missing: ${username}`);
  return list[0];
}

async function clearMfaAndSetPassword(token, username, password) {
  const user = await findUser(token, username);
  const actions = (user.requiredActions ?? []).filter((a) => a !== "CONFIGURE_TOTP");
  const put = await fetch(`${base}/admin/realms/${realm}/users/${user.id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...user, requiredActions: actions, enabled: true }),
  });
  if (!put.ok) throw new Error(`clear actions ${username}: HTTP ${put.status}`);

  const reset = await fetch(`${base}/admin/realms/${realm}/users/${user.id}/reset-password`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "password", value: password, temporary: false }),
  });
  if (!reset.ok) throw new Error(`reset-password ${username}: HTTP ${reset.status}`);
  console.log(`Fixed local login for ${username} (no CONFIGURE_TOTP, permanent password)`);
}

const token = await adminToken();
const targets = [
  [env.KC_DEV_USERNAME, env.KC_DEV_USER_PASSWORD],
  [env.KC_ADMIN_USERNAME, env.KC_ADMIN_PASSWORD],
  [env.KC_APPROVER_USERNAME, env.KC_APPROVER_PASSWORD],
].filter(([u, p]) => u && p);

for (const [username, password] of targets) {
  await clearMfaAndSetPassword(token, username, password);
}

console.log("Done. Login via ERP /login with those usernames.");

// SPDX-License-Identifier: AGPL-3.0-only
const base = (process.env.OIDC_BASE_URL || "http://keycloak:8080").replace(/\/$/, "");

async function main() {
  const tokRes = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error(`admin token failed: ${JSON.stringify(tok)}`);
  const username = process.env.KC_DEV_USERNAME;
  const password = process.env.KC_DEV_USER_PASSWORD;
  const list = await fetch(
    `${base}/admin/realms/nexora/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${tok.access_token}` } },
  ).then((r) => r.json());
  if (!list.length) throw new Error(`user ${username} missing`);
  const id = list[0].id;
  const reset = await fetch(`${base}/admin/realms/nexora/users/${id}/reset-password`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "password", value: password, temporary: false }),
  });
  if (!reset.ok) throw new Error(`reset-password HTTP ${reset.status}`);
  console.log(`Password reset non-temporary for ${username}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

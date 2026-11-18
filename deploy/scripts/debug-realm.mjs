// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";

const base = "http://keycloak:8080";

async function main() {
  const tok = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
    }),
  });
  const tj = await tok.json();
  if (!tj.access_token) {
    console.log("tok", tok.status, tj);
    process.exit(1);
  }
  const access = tj.access_token;
  const headers = {
    Authorization: `Bearer ${access}`,
    "Content-Type": "application/json",
  };

  const minimal = {
    realm: "nexora",
    enabled: true,
    registrationAllowed: false,
    clients: [
      {
        clientId: "erp-browser",
        enabled: true,
        publicClient: true,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: true,
        redirectUris: ["http://127.0.0.1:19080/*"],
        webOrigins: ["http://127.0.0.1:19080"],
      },
    ],
  };
  let res = await fetch(`${base}/admin/realms`, {
    method: "POST",
    headers,
    body: JSON.stringify(minimal),
  });
  console.log("minimal", res.status, await res.text());
  if (res.status === 201) {
    await fetch(`${base}/admin/realms/nexora`, { method: "DELETE", headers: { Authorization: headers.Authorization } });
    console.log("deleted minimal");
  }

  const full = JSON.parse(readFileSync("/bootstrap/realm-template.json", "utf8"));
  full.clients[0].redirectUris = ["http://127.0.0.1:19080/*"];
  full.clients[0].webOrigins = ["http://127.0.0.1:19080"];
  full.clients[0].directAccessGrantsEnabled = true;
  full.clients[1].redirectUris = ["http://127.0.0.1:19080/*"];
  full.clients[1].webOrigins = ["http://127.0.0.1:19080"];
  if (full.clients[2]) full.clients[2].secret = process.env.OIDC_GATEWAY_CLIENT_SECRET;

  const noRA = structuredClone(full);
  delete noRA.requiredActions;
  delete noRA.otpPolicy;
  res = await fetch(`${base}/admin/realms`, { method: "POST", headers, body: JSON.stringify(noRA) });
  console.log("noRA", res.status, await res.text());
  if (res.status === 201) {
    await fetch(`${base}/admin/realms/nexora`, { method: "DELETE", headers: { Authorization: headers.Authorization } });
  }

  res = await fetch(`${base}/admin/realms`, { method: "POST", headers, body: JSON.stringify(full) });
  console.log("full", res.status, await res.text());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

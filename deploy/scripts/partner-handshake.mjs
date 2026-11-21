// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Safe partner connectivity handshake against /api/v1/federation/connectivity.
 *
 * Usage:
 *   PARTNER_TOKEN=... PUBLIC_BASE_URL=https://localhost:19443 node deploy/scripts/partner-handshake.mjs
 *
 * Never logs the bearer token.
 */
const base = (process.env.PUBLIC_BASE_URL || "http://127.0.0.1:19080").replace(/\/$/, "");
const token = process.env.PARTNER_TOKEN;
if (!token) {
  console.error("PARTNER_TOKEN required");
  process.exit(1);
}

const response = await fetch(`${base}/api/v1/federation/connectivity`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    // Self-declared issuer must be ignored by server.
    issuerInstanceId: "forged-issuer-must-be-ignored",
  }),
  signal: AbortSignal.timeout(15000),
});

const text = await response.text();
console.log(`status=${response.status}`);
console.log(text.slice(0, 500));
process.exit(response.ok ? 0 : 2);

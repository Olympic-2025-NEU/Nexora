// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local HTTPS smoke after mkcert (P02-T06). Reads deploy/instances/<id>.env.
 * Token is fetched inside the Compose network (Keycloak is not published by default).
 * HTTPS checks hit the loopback gateway via localhost (mkcert SAN).
 *
 * Usage: node deploy/scripts/smoke-https-local.mjs [a]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const instance = process.argv[2] || "a";
const root = resolve(fileURLToPath(import.meta.url), "../..");
const envPath = resolve(root, `instances/${instance}.env`);
const env = parseEnv(readFileSync(envPath, "utf8"));
const project = process.env.COMPOSE_PROJECT_NAME || `nexora-${instance}`;
const base = (env.PUBLIC_BASE_URL || "https://localhost:19443").replace(
  /127\.0\.0\.1/,
  "localhost",
);

const tokenScript = `
const env = Object.fromEntries(
  require('fs').readFileSync('/env', 'utf8').split(/\\r?\\n/).filter(Boolean).filter((l) => !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  })
);
const body = new URLSearchParams({
  grant_type: 'password',
  client_id: env.OIDC_CLIENT_ID_ERP || 'erp-browser',
  username: env.KC_DEV_USERNAME || 'dev-staff',
  password: env.KC_DEV_USER_PASSWORD || '',
});
fetch('http://keycloak:8080/realms/nexora/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
}).then(async (r) => {
  const j = await r.json();
  if (!j.access_token) {
    console.error(JSON.stringify(j));
    process.exit(1);
  }
  process.stdout.write(j.access_token);
}).catch((e) => { console.error(e); process.exit(1); });
`;

const tokenProc = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    "deploy/compose.yml",
    "--env-file",
    envPath,
    "-p",
    project,
    "run",
    "--rm",
    "--no-deps",
    "-v",
    `${envPath}:/env:ro`,
    "worker",
    "node",
    "-e",
    tokenScript,
  ],
  { cwd: resolve(root, ".."), encoding: "utf8" },
);

if (tokenProc.status !== 0) {
  console.error("token_failed", tokenProc.stderr || tokenProc.stdout);
  process.exit(1);
}
const access = tokenProc.stdout.trim().split(/\r?\n/).at(-1);
if (!access || access.length < 20) {
  console.error("token_empty", tokenProc.stdout);
  process.exit(1);
}
console.log(`token\tok\tlen=${access.length}`);
console.log(`base\t${base}`);

async function check(name, url, init) {
  try {
    const res = await fetch(url, init);
    const body = (await res.text()).slice(0, 240);
    console.log(`${name}\t${res.status}\t${body}`);
    return res.status;
  } catch (err) {
    console.log(`${name}\tERR\t${err.cause?.message || err.message}`);
    return 0;
  }
}

const statuses = [];
statuses.push(await check("ping", `${base}/gateway/ping`));
statuses.push(
  await check("me_bearer", `${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${access}` },
  }),
);
statuses.push(
  await check("me_forged", `${base}/api/v1/me`, {
    headers: { "X-User-Id": "forged" },
  }),
);
statuses.push(await check("me_none", `${base}/api/v1/me`));

const ok =
  statuses[0] === 200 &&
  statuses[1] === 200 &&
  statuses[2] === 401 &&
  statuses[3] === 401;
console.log(ok ? "RESULT\tPASS" : "RESULT\tFAIL");
// Avoid process.exit after docker spawn on Windows (libuv assertion on close).
if (!ok) {
  throw new Error("https smoke failed");
}

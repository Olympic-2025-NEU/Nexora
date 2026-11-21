// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live P05 smoke against gateway HTTP.
 * Usage: node deploy/scripts/smoke-p05-local.mjs [a]
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
const project = `nexora-${instance}`;
const httpBase = `http://127.0.0.1:${env.GATEWAY_HTTP_PORT || "19080"}`;
const repoRoot = resolve(root, "..");

function compose(args) {
  return spawnSync(
    "docker",
    ["compose", "-f", "deploy/compose.yml", "--env-file", envPath, "-p", project, ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function lastLine(text) {
  return (text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
}

console.log("== seed ==");
const seedProc = compose([
  "run",
  "--rm",
  "--no-deps",
  "-v",
  `${resolve(root, "scripts/seed-system.mjs")}:/app/seed-system.mjs:ro`,
  "-e",
  // Seed needs write on system.organization; app_runtime only has SELECT (grant gap).
  `DATABASE_URL=${env.MIGRATOR_DATABASE_URL}`,
  "-e",
  `OIDC_BASE_URL=${env.OIDC_BASE_URL}`,
  "-e",
  `KC_BOOTSTRAP_ADMIN_USERNAME=${env.KC_BOOTSTRAP_ADMIN_USERNAME}`,
  "-e",
  `KC_BOOTSTRAP_ADMIN_PASSWORD=${env.KC_BOOTSTRAP_ADMIN_PASSWORD}`,
  "-e",
  `KC_DEV_USERNAME=${env.KC_DEV_USERNAME}`,
  "-e",
  `ORG_CODE=${env.ORG_CODE}`,
  "-e",
  `INSTANCE_ID=${env.INSTANCE_ID}`,
  "worker",
  "node",
  "/app/seed-system.mjs",
]);
console.log(lastLine(seedProc.stdout) || lastLine(seedProc.stderr));
if (seedProc.status !== 0) {
  console.error(seedProc.stderr || seedProc.stdout);
  process.exit(1);
}

console.log("== token ==");
const tokenScript = `
const body = new URLSearchParams({
  grant_type: 'password',
  client_id: process.env.OIDC_CLIENT_ID_ERP || 'erp-browser',
  username: process.env.KC_DEV_USERNAME,
  password: process.env.KC_DEV_USER_PASSWORD,
});
const r = await fetch('http://keycloak:8080/realms/nexora/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
const j = await r.json();
if (!j.access_token) { console.error(JSON.stringify(j)); process.exit(1); }
process.stdout.write(j.access_token);
`;
const tokProc = compose([
  "run",
  "--rm",
  "--no-deps",
  "-e",
  `OIDC_CLIENT_ID_ERP=${env.OIDC_CLIENT_ID_ERP}`,
  "-e",
  `KC_DEV_USERNAME=${env.KC_DEV_USERNAME}`,
  "-e",
  `KC_DEV_USER_PASSWORD=${env.KC_DEV_USER_PASSWORD}`,
  "worker",
  "node",
  "--input-type=module",
  "-e",
  tokenScript,
]);
const token = lastLine(tokProc.stdout);
if (tokProc.status !== 0 || !token || token.length < 20) {
  console.error(tokProc.stderr || tokProc.stdout);
  process.exit(1);
}
console.log("token_len", token.length);

async function req(name, path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) h.Authorization = `Bearer ${token}`;
  if (body && !h["content-type"]) h["content-type"] = "application/json";
  try {
    const res = await fetch(`${httpBase}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    console.log(`${name}\t${res.status}\t${text.slice(0, 220)}`);
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  } catch (e) {
    console.log(`${name}\tERR\t${e.message}`);
    return { status: 0, text: e.message, json: null };
  }
}

console.log("== gateway/api ==");
await req("ping", "/gateway/ping", { auth: false });
const me = await req("me", "/api/v1/me");
const orgGet = await req("org_get", "/api/v1/organization");
const version = orgGet.json?.data?.version ?? 1;
await req("org_patch", "/api/v1/organization", {
  method: "PATCH",
  headers: { "if-match": String(version) },
  body: { name: `Nexora Org ${env.ORG_CODE} smoke`, version },
});
await req("members", "/api/v1/members");
await req("partners", "/api/v1/partners");
await req("org_no_token", "/api/v1/organization", { auth: false });

console.log("== ui routes via gateway ==");
await req("admin_ui", "/admin", { auth: false });
await req("erp_ui", "/erp/", { auth: false });
await req("erp_admin", "/erp/admin", { auth: false });

console.log("== roles ==");
console.log("me.roles", me.json?.roles ?? me.json);

// SPDX-License-Identifier: AGPL-3.0-only
// Fresh ignored A/B/C env files for an isolated G09 clone; never overwrites local state.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { validateConfig } from "../config.mjs";

if (process.env.DEMO_ONLY !== "true" || process.env.NEXORA_DEMO_PROJECT_PREFIX !== "nexora-g09")
  throw new Error("DEMO_ONLY=true and NEXORA_DEMO_PROJECT_PREFIX=nexora-g09 required");
const root = resolve(import.meta.dirname, "../instances");
const offset = 2000;
const portKeys = ["GATEWAY_HTTP_PORT", "GATEWAY_HTTPS_PORT", "POSTGRES_HOST_PORT",
  "KEYCLOAK_HOST_PORT", "FLOWABLE_HOST_PORT"];
const prepared = [];
for (const instance of "abc") {
  const source = resolve(root, `${instance}.env.example`);
  const target = resolve(root, `${instance}.env`);
  if (existsSync(target)) throw new Error(`G09 env already exists for ${instance}; refusing overwrite`);
  const credentials = new Map();
  let text = readFileSync(source, "utf8").replace(/CHANGE_ME_[A-Z0-9_]+/g, (marker) => {
    if (!credentials.has(marker)) credentials.set(marker, randomBytes(24).toString("hex"));
    return credentials.get(marker);
  });
  const original = parseEnv(text);
  const values = Object.fromEntries(portKeys.map((key) => [key, String(Number(original[key]) + offset)]));
  const gateway = `http://127.0.0.1:${values.GATEWAY_HTTP_PORT}`;
  const keycloak = `http://127.0.0.1:${values.KEYCLOAK_HOST_PORT}`;
  Object.assign(values, { PUBLIC_BASE_URL: gateway, OIDC_FRONTEND_URL: keycloak,
    OIDC_ISSUER_URL: `${keycloak}/realms/nexora`,
    OIDC_REDIRECT_URI_ERP: `${gateway}/erp/callback`,
    OIDC_REDIRECT_URI_DXLAB: `${gateway}/dxlab/callback`,
    NEXORA_IMAGE_TAG: "g09-clean", FEDERATION_NETWORK_NAME: "nexora-g09-federation" });
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  const env = parseEnv(text);
  validateConfig(env);
  assert.equal(env.INSTANCE_ID, instance);
  assert.equal(env.PUBLIC_BASE_URL, gateway);
  prepared.push({ target, text });
}
for (const item of prepared) writeFileSync(item.target, item.text, { flag: "wx", mode: 0o600 });
console.log("Created isolated G09 env files for A/B/C; project nexora-g09-*, ports +2000, secrets redacted.");

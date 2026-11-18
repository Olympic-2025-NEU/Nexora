// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Render deploy/apisix/routes.yaml → apisix.generated.yaml with OIDC placeholders
 * substituted from an instance env file. APISIX standalone YAML does not expand ${VAR}.
 *
 * Usage: node deploy/scripts/render-apisix-routes.mjs deploy/instances/a.env
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const envFile = process.argv[2];
if (!envFile) {
  console.error("Usage: node deploy/scripts/render-apisix-routes.mjs <instance.env>");
  process.exit(1);
}

const root = resolve(fileURLToPath(import.meta.url), "../..");
const env = parseEnv(readFileSync(resolve(envFile), "utf8"));
const required = ["OIDC_ISSUER_URL", "OIDC_GATEWAY_CLIENT_ID", "OIDC_GATEWAY_CLIENT_SECRET"];
for (const key of required) {
  if (!env[key] || String(env[key]).includes("CHANGE_ME_")) {
    console.error(`Missing or unsubstituted ${key} in ${envFile}`);
    process.exit(1);
  }
}

const template = readFileSync(resolve(root, "apisix/routes.yaml"), "utf8");
const rendered = template
  .replaceAll("${OIDC_ISSUER_URL}", env.OIDC_ISSUER_URL)
  .replaceAll("${OIDC_GATEWAY_CLIENT_ID}", env.OIDC_GATEWAY_CLIENT_ID)
  .replaceAll("${OIDC_GATEWAY_CLIENT_SECRET}", env.OIDC_GATEWAY_CLIENT_SECRET);

const out = resolve(root, "apisix/apisix.generated.yaml");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rendered, { mode: 0o600 });
console.log(`Wrote ${out}`);

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Render deploy/apisix/routes.yaml → apisix.generated.yaml with OIDC placeholders
 * substituted from an instance env file. APISIX standalone YAML does not expand ${VAR}.
 * When deploy/certs/local.pem + local-key.pem exist, append an ssls entry for HTTPS.
 *
 * Usage: node deploy/scripts/render-apisix-routes.mjs deploy/instances/a.env
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

const erpUpstream = (env.ERP_UPSTREAM || "erp:3000").trim();
const template = readFileSync(resolve(root, "apisix/routes.yaml"), "utf8");
let rendered = template
  .replaceAll("${OIDC_ISSUER_URL}", env.OIDC_ISSUER_URL)
  .replaceAll("${OIDC_GATEWAY_CLIENT_ID}", env.OIDC_GATEWAY_CLIENT_ID)
  .replaceAll("${OIDC_GATEWAY_CLIENT_SECRET}", env.OIDC_GATEWAY_CLIENT_SECRET)
  .replaceAll("${ERP_UPSTREAM}", erpUpstream);
console.log(`ERP upstream nodes → ${erpUpstream}`);

const certPath = resolve(root, "certs/local.pem");
const keyPath = resolve(root, "certs/local-key.pem");
if (existsSync(certPath) && existsSync(keyPath)) {
  const indent = (pem) =>
    pem
      .replace(/\r\n/g, "\n")
      .trim()
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");
  const cert = indent(readFileSync(certPath, "utf8"));
  const key = indent(readFileSync(keyPath, "utf8"));
  const sslBlock = `
ssls:
  - id: local-mkcert
    snis:
      - "127.0.0.1"
      - "localhost"
      - "gateway-${env.INSTANCE_ID}.nexora.test"
    cert: |
${cert}
    key: |
${key}
`;
  rendered = rendered.replace(/\r?\n?#END\s*$/, `${sslBlock}\n#END\n`);
  console.log("Injected ssls from deploy/certs/local.pem");
} else {
  console.log("No deploy/certs/local.pem — HTTPS ssls omitted (HTTP smoke only)");
}

const relative = env.APISIX_RENDERED_PATH || "./apisix/apisix.generated.yaml";
const out = resolve(root, relative);
if (env.APISIX_RENDERED_PATH && (
  !/^[abc]$/.test(env.INSTANCE_ID ?? "") ||
  out !== resolve(root, "instances", env.INSTANCE_ID, "apisix.generated.yaml")
)) {
  console.error("Invalid APISIX_RENDERED_PATH");
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rendered, { mode: 0o600 });
console.log(`Wrote ${out}`);

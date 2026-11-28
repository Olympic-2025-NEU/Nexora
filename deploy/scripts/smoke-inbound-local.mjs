// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Smoke: local supplier CRUD + inbound list BFF (ADR 0020).
 * Usage: node deploy/scripts/smoke-inbound-local.mjs [a] [baseUrl]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const instance = process.argv[2] || "a";
const baseUrl = (process.argv[3] || "http://127.0.0.1:3000").replace(/\/$/, "");
const root = resolve(fileURLToPath(import.meta.url), "../..");
const envPath = resolve(root, `instances/${instance}.env`);
const env = parseEnv(readFileSync(envPath, "utf8"));
const kcHost = `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT || "18080"}`;

let pass = 0;
const ok = (name) => {
  pass += 1;
  console.log(`PASS  ${name}`);
};
const fail = (name, detail) => {
  console.log(`FAIL  ${name} — ${detail}`);
  process.exitCode = 1;
};

async function token() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: env.OIDC_CLIENT_ID_ERP || "erp-browser",
    username: env.KC_DEV_USERNAME,
    password: env.KC_DEV_USER_PASSWORD,
  });
  const r = await fetch(`${kcHost}/realms/nexora/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function api(accessToken, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
      "x-request-id": randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log(`Inbound local smoke → ${baseUrl} (instance ${instance})`);
  const accessToken = await token();
  ok(`token (${accessToken.length} chars)`);

  const code = `LS-${Date.now().toString(36).toUpperCase()}`;
  const create = await api(accessToken, "POST", "/api/v1/local-suppliers", {
    code,
    displayName: `Smoke supplier ${code}`,
    contactPhone: "0900000000",
  });
  if (create.status === 201 && create.json?.data?.id) {
    ok(`create local-supplier ${create.json.data.code}`);
  } else {
    fail("create local-supplier", `${create.status} ${create.text.slice(0, 240)}`);
    return;
  }

  const listSup = await api(accessToken, "GET", "/api/v1/local-suppliers?status=active");
  if (listSup.status === 200 && Array.isArray(listSup.json?.data)) {
    ok(`list local-suppliers (${listSup.json.data.length})`);
  } else {
    fail("list local-suppliers", `${listSup.status} ${listSup.text.slice(0, 200)}`);
  }

  const patch = await api(
    accessToken,
    "PATCH",
    `/api/v1/local-suppliers/${create.json.data.id}`,
    { note: "smoke note" },
  );
  // If-Match required
  if (patch.status === 428) ok("patch requires If-Match");
  else fail("patch If-Match", `${patch.status}`);

  const patched = await fetch(`${baseUrl}/api/v1/local-suppliers/${create.json.data.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "if-match": String(create.json.data.version),
      "x-request-id": randomUUID(),
    },
    body: JSON.stringify({ note: "smoke note" }),
  });
  const patchedJson = await patched.json().catch(() => ({}));
  if (patched.status === 200 && patchedJson.data?.note === "smoke note") {
    ok("patch local-supplier");
  } else {
    fail("patch local-supplier", `${patched.status} ${JSON.stringify(patchedJson).slice(0, 200)}`);
  }

  const inbound = await api(accessToken, "GET", "/api/v1/inbound");
  if (inbound.status === 200 && Array.isArray(inbound.json?.data)) {
    ok(`GET /api/v1/inbound (${inbound.json.data.length} rows)`);
  } else {
    fail("inbound list", `${inbound.status} ${inbound.text.slice(0, 200)}`);
  }

  const inboundLocal = await api(accessToken, "GET", "/api/v1/inbound?sourceKind=local");
  if (inboundLocal.status === 200) ok("inbound filter sourceKind=local");
  else fail("inbound filter", `${inboundLocal.status}`);

  console.log(`Done: ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

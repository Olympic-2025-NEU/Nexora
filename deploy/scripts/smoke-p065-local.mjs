// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live P065 catalog smoke against host Next (`npm run dev`) or gateway.
 * Usage: node deploy/scripts/smoke-p065-local.mjs [a] [baseUrl]
 * Default baseUrl: http://127.0.0.1:3000
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
const fails = [];
let pass = 0;

function ok(name) {
  pass += 1;
  console.log(`PASS  ${name}`);
}
function fail(name, detail) {
  fails.push(`${name}: ${detail}`);
  console.log(`FAIL  ${name} — ${detail}`);
}

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
  console.log(`P065 smoke → ${baseUrl} (instance ${instance})`);
  const accessToken = await token();
  ok(`token (${accessToken.length} chars)`);

  const anon = await fetch(`${baseUrl}/api/v1/products`);
  if (anon.status === 401 || anon.status === 403) ok("anonymous products blocked");
  else fail("anonymous products blocked", `status ${anon.status}`);

  const cats = await api(accessToken, "GET", "/api/v1/categories");
  if (cats.status === 200 && Array.isArray(cats.json?.data) && cats.json.data.length > 0) {
    ok(`GET categories (${cats.json.data.length})`);
  } else fail("GET categories", `${cats.status} ${cats.text.slice(0, 180)}`);

  const uncategorized = cats.json?.data?.find((c) => c.code === "UNCATEGORIZED") ?? cats.json?.data?.[0];
  if (!uncategorized?.id) {
    fail("seed category", "missing");
    throw new Error("no category");
  }

  const uoms = await api(accessToken, "GET", "/api/v1/uoms");
  if (uoms.status === 200 && uoms.json?.data?.some((u) => u.name === "CÁI" && u.isSystemDefault)) {
    ok("GET uoms includes system CÁI");
  } else fail("GET uoms CÁI", `${uoms.status} ${uoms.text.slice(0, 180)}`);

  const dupUom = await api(accessToken, "POST", "/api/v1/uoms", { name: "cái", kind: "count" });
  if (dupUom.status === 409) ok("UOM normalize conflict 409");
  else fail("UOM normalize conflict", `${dupUom.status} ${dupUom.text.slice(0, 180)}`);

  const sku = `SMK-${Date.now().toString(36).toUpperCase()}`;
  const created = await api(accessToken, "POST", "/api/v1/products", {
    name: `Smoke Product ${sku}`,
    categoryId: uncategorized.id,
    sku,
    barcode: sku,
  });
  if (created.status === 201 && created.json?.data?.id && !("sku" in (created.json.data || {}))) {
    ok("POST product 201 (no sku on product body)");
  } else fail("POST product", `${created.status} ${created.text.slice(0, 220)}`);

  const productId = created.json?.data?.id;
  const variants = await api(accessToken, "GET", `/api/v1/products/${productId}/variants`);
  const primary = variants.json?.data?.find((v) => v.sku === sku);
  if (variants.status === 200 && primary?.isPrimary && primary.barcode === sku) {
    ok("primary variant sku=barcode");
  } else fail("list variants", `${variants.status} ${variants.text.slice(0, 220)}`);

  const conflict = await api(accessToken, "POST", `/api/v1/products/${productId}/variants`, {
    sku,
  });
  if (conflict.status === 409) ok("SKU conflict 409");
  else fail("SKU conflict", `${conflict.status} ${conflict.text.slice(0, 180)}`);

  const onlyBarcode = await api(accessToken, "POST", `/api/v1/products/${productId}/variants`, {
    barcode: `BC-${sku}`,
  });
  if (onlyBarcode.status === 201) ok("variant barcode-only 201");
  else fail("variant barcode-only", `${onlyBarcode.status} ${onlyBarcode.text.slice(0, 180)}`);

  const lists = await api(accessToken, "GET", "/api/v1/price-lists");
  const def = lists.json?.data?.find((p) => p.isDefault && p.code == null);
  if (lists.status === 200 && def) ok("default general price list");
  else fail("price lists", `${lists.status} ${lists.text.slice(0, 180)}`);

  const products = await api(accessToken, "GET", `/api/v1/products?q=${encodeURIComponent(sku)}`);
  if (products.status === 200 && products.json?.data?.some((p) => p.id === productId)) {
    ok("product search by variant sku");
  } else fail("product search", `${products.status} ${products.text.slice(0, 180)}`);

  const ident = await api(accessToken, "POST", `/api/v1/products/${productId}/identifiers`, {
    kind: "ean13",
    value: "4006381333931",
  });
  if (ident.status === 410) ok("identifiers route 410");
  else fail("identifiers 410", `${ident.status}`);

  console.log("");
  console.log(`Result: ${pass} passed, ${fails.length} failed`);
  if (fails.length) {
    for (const f of fails) console.error(` - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

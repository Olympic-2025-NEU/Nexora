// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live commercial order checkout smoke (ADR 0019).
 * Usage: node deploy/scripts/smoke-orders-checkout.mjs [a] [baseUrl]
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
const ok = (name) => {
  pass += 1;
  console.log(`PASS  ${name}`);
};
const fail = (name, detail) => {
  fails.push(`${name}: ${detail}`);
  console.log(`FAIL  ${name} — ${detail}`);
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

async function api(accessToken, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
      "x-request-id": randomUUID(),
      ...extraHeaders,
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
  console.log(`Orders checkout smoke → ${baseUrl} (instance ${instance})`);
  const accessToken = await token();
  ok(`token (${accessToken.length} chars)`);

  const wh = await api(accessToken, "GET", "/api/v1/warehouses");
  const warehouse = wh.json?.data?.find((w) => w.status === "active") ?? wh.json?.data?.[0];
  if (wh.status === 200 && warehouse?.id) ok(`warehouse ${warehouse.code || warehouse.id}`);
  else {
    fail("warehouses", `${wh.status} ${wh.text.slice(0, 200)}`);
    throw new Error("no warehouse");
  }

  const members = await api(accessToken, "GET", "/api/v1/members");
  const seller =
    members.json?.data?.find((m) => m.status === "active" && (m.role === "administrator" || m.roles?.includes?.("administrator") || m.roles?.includes?.("sales_clerk") || m.role === "sales_clerk")) ??
    members.json?.data?.find((m) => m.status === "active");
  if (members.status === 200 && seller?.id) ok(`seller ${seller.displayName || seller.id}`);
  else fail("members", `${members.status} ${members.text.slice(0, 180)}`);

  const products = await api(accessToken, "GET", "/api/v1/products?limit=50&isActive=true");
  const priced = (products.json?.data ?? []).filter((p) => p.primaryVariantId && p.baseUomId && p.priceRetail);
  if (products.status !== 200 || !priced.length) {
    fail("products with price", `${products.status} ${products.text.slice(0, 200)}`);
    throw new Error("no priced product");
  }

  let product = null;
  let batch = null;
  for (const candidate of priced) {
    const batches = await api(
      accessToken,
      "GET",
      `/api/v1/batches?productVariantId=${candidate.primaryVariantId}&status=available`,
    );
    if (batches.status === 200 && batches.json?.data?.[0]) {
      product = candidate;
      batch = batches.json.data[0];
      break;
    }
  }

  if (!product) {
    product = priced[0];
    const createdBatch = await api(accessToken, "POST", "/api/v1/batches", {
      productVariantId: product.primaryVariantId,
      localCode: `SMK-${Date.now().toString(36).toUpperCase()}`,
    });
    if (createdBatch.status !== 201 || !createdBatch.json?.data?.id) {
      fail("create batch", `${createdBatch.status} ${createdBatch.text.slice(0, 220)}`);
      throw new Error("no batch");
    }
    batch = createdBatch.json.data;
    const release = await api(
      accessToken,
      "POST",
      `/api/v1/batches/${batch.id}/quality-actions`,
      { action: "mark_available", reason: "smoke seed available" },
      { "idempotency-key": randomUUID(), "if-match": String(batch.version ?? 1) },
    );
    if (![200, 201].includes(release.status)) {
      fail("batch quality", `${release.status} ${release.text.slice(0, 220)}`);
      throw new Error("batch not available");
    }
    batch = release.json?.data ?? batch;
    ok(`batch mark_available ${batch.localCode || batch.id}`);
  }

  ok(`product ${product.name} variant=${product.primaryVariantId.slice(0, 8)}`);
  ok(`batch ${batch.localCode || batch.id}`);

  // Seed stock via goods receipt create+confirm
  const receipt = await api(accessToken, "POST", "/api/v1/receipts", {
    lines: [
      {
        warehouseId: warehouse.id,
        productVariantId: product.primaryVariantId,
        batchId: batch.id,
        quantity: "20",
        uomId: product.baseUomId,
      },
    ],
    note: "smoke-orders seed",
  });
  if (receipt.status !== 201 || !receipt.json?.data?.id) {
    fail("receipt create", `${receipt.status} ${receipt.text.slice(0, 300)}`);
    throw new Error("receipt create failed");
  }
  ok(`receipt draft ${receipt.json.data.documentNumber}`);

  const confirmReceipt = await api(
    accessToken,
    "POST",
    `/api/v1/receipts/${receipt.json.data.id}/confirm`,
    {},
    {
      "if-match": String(receipt.json.data.version),
      "idempotency-key": randomUUID(),
    },
  );
  if (confirmReceipt.status !== 200 || confirmReceipt.json?.data?.status !== "confirmed") {
    fail("receipt confirm", `${confirmReceipt.status} ${confirmReceipt.text.slice(0, 300)}`);
    throw new Error("receipt confirm failed");
  }
  ok(`receipt confirmed movements=${confirmReceipt.json.data.movementIds?.length ?? "?"}`);

  const checkout = await api(
    accessToken,
    "POST",
    "/api/v1/orders/checkout",
    {
      warehouseId: warehouse.id,
      sellerMembershipId: seller.id,
      paymentMethod: "cash",
      paidAmount: "50000",
      discountAmount: "0",
      soldAt: new Date().toISOString(),
      lines: [
        {
          productVariantId: product.primaryVariantId,
          uomId: product.baseUomId,
          quantity: "2",
          unitPrice: String(product.priceRetail),
          priceType: "retail",
        },
      ],
    },
    { "idempotency-key": randomUUID() },
  );

  if (checkout.status !== 201 && checkout.status !== 200) {
    fail("checkout", `${checkout.status} ${checkout.text.slice(0, 400)}`);
  } else {
    const order = checkout.json?.data;
    if (order?.status === "fulfilled" && order.orderNumber && order.linkedIssueId) {
      ok(`checkout fulfilled ${order.orderNumber}`);
    } else {
      fail("checkout status", JSON.stringify(order)?.slice(0, 300));
    }
    if (order?.publicTraceToken && order?.qrUrl) {
      ok(`trace token+qr ${order.qrUrl}`);
    } else if (order?.publicTraceToken || order?.qrPath || order?.qrUrl) {
      ok(`trace present token=${Boolean(order.publicTraceToken)} qr=${order.qrUrl || order.qrPath}`);
    } else {
      fail("trace token", `missing in ${JSON.stringify(order)?.slice(0, 300)}`);
    }

    const get = await api(accessToken, "GET", `/api/v1/orders/${order.id}`);
    if (get.status === 200 && get.json?.data?.status === "fulfilled") {
      ok(`GET order ${get.json.data.orderNumber} lots=${get.json.data.lines?.[0]?.lots?.length ?? 0}`);
    } else {
      fail("GET order", `${get.status} ${get.text.slice(0, 220)}`);
    }

    const list = await api(accessToken, "GET", "/api/v1/orders");
    if (list.status === 200 && Array.isArray(list.json?.data) && list.json.data.some((o) => o.id === order.id)) {
      ok(`list orders includes ${order.orderNumber}`);
    } else {
      fail("list orders", `${list.status} ${list.text.slice(0, 200)}`);
    }
  }

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

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refresh business data (keep admin) + seed explicit inbound demo data + test local receipt.
 *
 * Usage: node deploy/scripts/seed-and-test-inbound.mjs [a] [baseUrl]
 *
 * Creates (fixed labels, not random):
 * 1. Kho chính — WH-HCM-01
 * 2. NCC lẻ — NCC-TANHUNG / Công ty TNHH Tân Hưng
 * 3. SP — Gạo ST25 túi 5kg / SKU GAO-ST25-5KG
 * 4. Lô — LOT-ST25-202611
 * 5. Phiếu nhập local 10 CÁI → confirm
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const instance = process.argv[2] || "a";
const baseUrl = (process.argv[3] || "http://127.0.0.1:3000").replace(/\/$/, "");
const root = resolve(fileURLToPath(import.meta.url), "../..");
const envPath = resolve(root, `instances/${instance}.env`);
const env = parseEnv(readFileSync(envPath, "utf8"));
const kcHost = `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT || "18080"}`;

const UOM_CAI = "aaaaaaaa-0001-4000-8000-000000000001";
const CAT_UNCATEGORIZED = "bbbbbbbb-0001-4000-8000-000000000001";

let pass = 0;
const ok = (name) => {
  pass += 1;
  console.log(`PASS  ${name}`);
};
const fail = (name, detail) => {
  console.error(`FAIL  ${name} — ${detail}`);
  process.exit(1);
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

async function api(accessToken, method, path, body, extra = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      "x-request-id": randomUUID(),
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

function refreshSql() {
  const sqlPath = resolve(root, "scripts/refresh-keep-admin.sql");
  console.log("\n== Refresh DB (keep organization + membership) ==");
  const result = spawnSync(
    "docker",
    ["exec", "-i", "nexora-postgres-1", "psql", "-U", "migrator", "-d", "nexora", "-v", "ON_ERROR_STOP=1"],
    {
      cwd: resolve(root, ".."),
      input: readFileSync(sqlPath),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    fail("refresh sql", `exit ${result.status}`);
  }
  ok("truncate business tables");
}

async function main() {
  console.log(`Seed+test inbound → ${baseUrl} (instance ${instance})`);
  refreshSql();

  const accessToken = await token();
  ok(`token as ${env.KC_DEV_USERNAME}`);

  const me = await api(accessToken, "GET", "/api/v1/me");
  if (me.status !== 200) fail("GET /me", `${me.status} ${me.text.slice(0, 200)}`);
  const roles = me.json?.data?.roles ?? me.json?.roles ?? [];
  ok(`admin session roles=${JSON.stringify(roles).slice(0, 80)}`);

  // 1) Warehouse
  console.log("\n== 1. Kho chính ==");
  const whCreate = await api(accessToken, "POST", "/api/v1/warehouses", {
    code: "WH-HCM-01",
    name: "Kho chính Quận 7",
  });
  if (whCreate.status !== 201 && whCreate.status !== 200) {
    fail("create warehouse", `${whCreate.status} ${whCreate.text.slice(0, 300)}`);
  }
  const warehouseId = whCreate.json.data.id;
  ok(`warehouse WH-HCM-01 → ${warehouseId}`);

  // Assign warehouse to current membership if members API supports it
  const members = await api(accessToken, "GET", "/api/v1/admin/members");
  const member =
    members.json?.data?.find?.((m) => m.email || m.displayName) ??
    members.json?.data?.[0];
  if (member?.id && Array.isArray(member.warehouseIds)) {
    const patch = await api(
      accessToken,
      "PATCH",
      `/api/v1/admin/members/${member.id}`,
      { warehouseIds: [warehouseId] },
      { "If-Match": String(member.version ?? 1) },
    );
    if (patch.status === 200) ok(`assign warehouse to membership ${member.id.slice(0, 8)}`);
    else console.warn(`WARN assign warehouse ${patch.status} ${patch.text.slice(0, 160)}`);
  } else {
    // Direct SQL fallback for membership_warehouse
    const membershipId = await resolveMembershipId();
    if (membershipId) {
      const sql = `INSERT INTO system.membership_warehouse (membership_id, warehouse_id)
        VALUES ('${membershipId}'::uuid, '${warehouseId}'::uuid)
        ON CONFLICT DO NOTHING;`;
      const ins = spawnSync(
        "docker",
        ["exec", "-i", "nexora-postgres-1", "psql", "-U", "migrator", "-d", "nexora", "-v", "ON_ERROR_STOP=1", "-c", sql],
        { encoding: "utf8" },
      );
      if (ins.status === 0) ok(`SQL assign membership_warehouse ${membershipId.slice(0, 8)}`);
      else fail("membership_warehouse", ins.stderr || ins.stdout);
    }
  }

  // 2) Local supplier
  console.log("\n== 2. NCC lẻ ==");
  const sup = await api(accessToken, "POST", "/api/v1/local-suppliers", {
    code: "NCC-TANHUNG",
    displayName: "Công ty TNHH Tân Hưng",
    contactPhone: "02838765432",
    contactEmail: "muahang@tanhung.vn",
    note: "NCC gạo nội địa — không liên kết Nexora",
  });
  if (sup.status !== 201) fail("create supplier", `${sup.status} ${sup.text.slice(0, 300)}`);
  const supplierId = sup.json.data.id;
  ok(`supplier NCC-TANHUNG → ${supplierId}`);

  // 3) Product + variant
  console.log("\n== 3. Sản phẩm Gạo ST25 ==");
  const product = await api(accessToken, "POST", "/api/v1/products", {
    name: "Gạo ST25 túi 5kg",
    categoryId: CAT_UNCATEGORIZED,
    isActive: true,
    sku: "GAO-ST25-5KG",
    barcode: "8935001234567",
  });
  if (product.status !== 201 && product.status !== 200) {
    fail("create product", `${product.status} ${product.text.slice(0, 400)}`);
  }
  const productId = product.json.data.id;
  ok(`product Gạo ST25 → ${productId}`);

  const variants = await api(accessToken, "GET", `/api/v1/products/${productId}/variants`);
  let variantId = variants.json?.data?.[0]?.id;
  if (!variantId) {
    const v = await api(accessToken, "POST", `/api/v1/products/${productId}/variants`, {
      sku: "GAO-ST25-5KG",
      barcode: "8935001234567",
      isPrimary: true,
      isActive: true,
    });
    if (v.status !== 201) fail("create variant", `${v.status} ${v.text.slice(0, 300)}`);
    variantId = v.json.data.id;
  }
  ok(`variant GAO-ST25-5KG → ${variantId}`);

  // Product createVariant already attaches stock UOM CÁI
  const uoms = await api(accessToken, "GET", `/api/v1/variants/${variantId}/uoms`);
  const hasCai = (uoms.json?.data ?? []).some((u) => u.uomId === UOM_CAI && u.isStockKeeping);
  if (!hasCai) fail("variant UOM", `missing CÁI stock UOM: ${JSON.stringify(uoms.json?.data)}`);
  ok("UOM CÁI stock-keeping on variant");

  // 4) Batch
  console.log("\n== 4. Lô LOT-ST25-202611 ==");
  const batch = await api(accessToken, "POST", "/api/v1/batches", {
    productVariantId: variantId,
    localCode: "LOT-ST25-202611",
    manufacturedOn: "2026-11-01",
    expiresOn: "2027-11-01",
  });
  if (batch.status !== 201) fail("create batch", `${batch.status} ${batch.text.slice(0, 400)}`);
  const batchId = batch.json.data.id;
  ok(`batch LOT-ST25-202611 → ${batchId}`);

  // New batches start as inspect — release to available before receipt confirm
  const batchVersion = batch.json.data.version ?? 1;
  const quality = batch.json.data.qualityStatus ?? "inspect";
  if (quality !== "available") {
    const mark = await api(
      accessToken,
      "POST",
      `/api/v1/batches/${batchId}/quality-actions`,
      {
        action: "mark_available",
        reason: "Lô mới nhập kiểm đạt",
        version: batchVersion,
      },
      {
        "Idempotency-Key": randomUUID(),
        "If-Match": String(batchVersion),
      },
    );
    if (mark.status !== 200) fail("mark_available", `${mark.status} ${mark.text.slice(0, 300)}`);
    ok(`batch quality ${quality} → available`);
  } else {
    ok("batch already available");
  }

  // 5) Local inbound receipt
  console.log("\n== 5. Phiếu nhập NCC lẻ (10 túi) ==");
  const draft = await api(accessToken, "POST", "/api/v1/receipts", {
    note: "Nhập gạo ST25 từ Tân Hưng — đợt 11/2026",
    localSupplierId: supplierId,
    lines: [
      {
        warehouseId,
        productVariantId: variantId,
        batchId,
        uomId: UOM_CAI,
        quantity: "10",
      },
    ],
  });
  if (draft.status !== 201) fail("create receipt draft", `${draft.status} ${draft.text.slice(0, 500)}`);
  const receiptId = draft.json.data.id;
  const version = draft.json.data.version;
  ok(`receipt draft ${draft.json.data.documentNumber} supplier=${draft.json.data.localSupplierId?.slice(0, 8)}`);

  const confirm = await api(
    accessToken,
    "POST",
    `/api/v1/receipts/${receiptId}/confirm`,
    {},
    { "If-Match": String(version), "Idempotency-Key": randomUUID() },
  );
  if (confirm.status !== 200) fail("confirm receipt", `${confirm.status} ${confirm.text.slice(0, 500)}`);
  ok(`receipt confirmed status=${confirm.json.data.status}`);

  // 6) Verify inbound list + balance
  console.log("\n== 6. Verify ==");
  const inbound = await api(accessToken, "GET", "/api/v1/inbound?sourceKind=local");
  if (inbound.status !== 200) fail("inbound list", `${inbound.status}`);
  const row = (inbound.json.data ?? []).find((r) => r.id === receiptId);
  if (!row) fail("inbound list", "receipt missing");
  if (row.counterpartyLabel && !row.counterpartyLabel.includes("Tân Hưng")) {
    fail("counterpartyLabel", row.counterpartyLabel);
  }
  ok(`inbound list shows ${row.documentNumber} · ${row.counterpartyLabel}`);

  const options = await api(accessToken, "GET", "/api/v1/receivings?options=1");
  if (options.status !== 200) fail("receivings options", `${options.status} ${options.text.slice(0, 200)}`);
  ok("receivings?options=1 OK (no INSTANCE_ID crash)");

  const bal = await api(
    accessToken,
    "GET",
    `/api/v1/inventory/balances?warehouseId=${warehouseId}&batchId=${batchId}`,
  );
  if (bal.status === 200) {
    const qty = bal.json?.data?.[0]?.quantity ?? bal.json?.data?.[0]?.onHand;
    ok(`stock balance after confirm qty=${qty ?? "n/a"}`);
  } else {
    console.warn(`WARN balances ${bal.status}`);
  }

  console.log(`\nDone: ${pass} checks passed`);
  console.log("UI: /trading/inbound  |  /trading/suppliers  |  NCC-TANHUNG + Gạo ST25");
}

async function resolveMembershipId() {
  const sql = `SELECT id::text FROM system.membership WHERE status = 'active' ORDER BY created_at ASC LIMIT 1;`;
  const r = spawnSync(
    "docker",
    ["exec", "-i", "nexora-postgres-1", "psql", "-U", "migrator", "-d", "nexora", "-tA", "-c", sql],
    { encoding: "utf8" },
  );
  return r.status === 0 ? r.stdout.trim() : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

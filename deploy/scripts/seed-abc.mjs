// SPDX-License-Identifier: AGPL-3.0-only
// P09-T01: idempotent, zero-stock A/B/C fixture. Run only against named demo projects.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient, Prisma } from "@prisma/client";
import { validateConfig } from "../config.mjs";
import { demoProject } from "./demo-project.mjs";

const instance = process.argv[2];
if (process.env.DEMO_ONLY !== "true" || !/^[abc]$/.test(instance ?? "")) {
  console.error("seed-abc requires DEMO_ONLY=true and instance a|b|c");
  process.exit(1);
}
const root = resolve(import.meta.dirname, "../..");
const file = resolve(root, "deploy", "instances", `${instance}.env`);
const values = parseEnv(readFileSync(file, "utf8"));
validateConfig(values);
if (values.INSTANCE_ID !== instance || values.ORG_CODE !== `ORG-${instance.toUpperCase()}` ||
    values.PUBLIC_BASE_URL !== `http://127.0.0.1:${values.GATEWAY_HTTP_PORT}` ||
    values.APISIX_RENDERED_PATH !== `./instances/${instance}/apisix.generated.yaml`) {
  throw new Error("Demo instance identity mismatch");
}
const project = demoProject(instance);
const compose = ["compose", "-f", "deploy/compose.yml", "-f",
  "deploy/compose.local-admin.yml", "--env-file", file, "-p", project];
const ps = spawnSync("docker", [...compose, "ps", "-q", "postgres"],
  { cwd: root, encoding: "utf8" });
if (ps.status !== 0 || !ps.stdout.trim()) throw new Error("Demo Postgres service is not running");
const inspect = spawnSync("docker", ["inspect", "--format",
  "{{index .Config.Labels \"com.docker.compose.project\"}}", ps.stdout.trim()],
{ encoding: "utf8" });
if (inspect.status !== 0 || inspect.stdout.trim() !== project)
  throw new Error("Postgres project label mismatch");

const localUrl = new URL(values.MIGRATOR_DATABASE_URL);
localUrl.hostname = "127.0.0.1";
localUrl.port = values.POSTGRES_HOST_PORT;
const env = { ...process.env, ...values, NODE_ENV: "test", DEMO_ONLY: "true",
  DATABASE_URL: localUrl.href,
  OIDC_BASE_URL: `http://127.0.0.1:${values.KEYCLOAK_HOST_PORT}`,
  SEED_OPENING_QTY: "0", SEED_PRODUCT_SKU: `${instance.toUpperCase()}-P1`,
  SEED_ORIGIN_ISSUER_INSTANCE_ID: "nexora-a",
  SEED_ORIGIN_LOT_ID: stableUuid("a", "batch") };
function stableUuid(part, label) {
  const hex = createHash("sha256").update(`${part}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function seedAiDemoLot(prisma, admin) {
  const sku = "A-AI-P1";
  const localCode = "LOT-A-001";
  const originIssuerInstanceId = "nexora-b";
  const originLotId = stableUuid("b", "batch");
  // ponytail: fixed date keeps seed idempotent; refresh after 2026-12-08.
  const expiresOn = new Date("2026-12-08T00:00:00.000Z");
  const product = await prisma.product.upsert({
    where: { id: stableUuid("a", "ai-demo-product") },
    create: { id: stableUuid("a", "ai-demo-product"), name: "Demo Product AI B",
      searchText: "demo ai duplicate lot issuer b",
      attributes: { description: "P10-T03 duplicate-lot demo" },
      categoryId: "bbbbbbbb-0001-4000-8000-000000000001", isActive: true,
      createdBySub: admin.keycloakSub },
    update: {},
  });
  const variant = await prisma.productVariant.upsert({
    where: { id: stableUuid("a", "ai-demo-variant") },
    create: { id: stableUuid("a", "ai-demo-variant"), productId: product.id, sku,
      barcode: sku, isPrimary: true, isActive: true, createdBySub: admin.keycloakSub },
    update: {},
  });
  await prisma.variantCode.upsert({ where: { code: sku },
    create: { code: sku, variantId: variant.id, source: "both" }, update: {} });
  await prisma.productVariantUom.upsert({
    where: { productVariantId_uomId: { productVariantId: variant.id,
      uomId: "aaaaaaaa-0001-4000-8000-000000000001" } },
    create: { id: stableUuid("a", "ai-demo-variant-uom"), productVariantId: variant.id,
      uomId: "aaaaaaaa-0001-4000-8000-000000000001", isStockKeeping: true,
      factorToStockUom: new Prisma.Decimal(1) },
    update: {},
  });
  const partner = await prisma.partner.findUnique({ where: { issuerInstanceId: originIssuerInstanceId } });
  const batch = await prisma.batch.upsert({
    where: { originIssuerInstanceId_originLotId: { originIssuerInstanceId, originLotId } },
    create: { id: stableUuid("a", "ai-demo-batch"), productId: product.id,
      productVariantId: variant.id, localCode, originIssuerInstanceId, originLotId,
      qualityStatus: "available", sourcePartnerId: partner?.id ?? null,
      expiresOn, createdBySub: admin.keycloakSub },
    update: { expiresOn },
  });
  return { batchId: batch.id, productVariantId: variant.id, sku, localCode,
    originIssuerInstanceId, originLotId };
}
function run(script, childEnv) {
  const child = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) {
    let details = (child.stderr || child.stdout).trim();
    for (const [name, value] of Object.entries(values)) {
      if (/PASSWORD|SECRET|DATABASE_URL|ACCESS_KEY|KEY_REF/.test(name) && value)
        details = details.replaceAll(value, "[redacted]");
    }
    console.error(`${script} failed (exit ${child.status}): ${details.slice(0, 800)}`);
    process.exit(1);
  }
}
const prisma = new PrismaClient({ datasources: { db: { url: localUrl.href } } });
try {
  run("deploy/scripts/seed-system.mjs", env);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { singletonSlot: 1 } });
  if (organization.instanceId !== `nexora-${instance}`) throw new Error("Database instance mismatch");
  const members = await prisma.membership.findMany({
    where: { status: "active" },
    include: { roles: true },
  });
  const memberHas = (row, code) =>
    row.roles.some((r) => r.role === code) || row.role === code;
  if (!members.some((row) => memberHas(row, "administrator"))) {
    throw new Error("Missing demo role administrator");
  }
  const nonAdmin = members.filter((row) => !memberHas(row, "administrator"));
  run("deploy/scripts/seed-catalog.mjs", { ...env,
    SEED_STAFF_SUBS: (nonAdmin.length ? nonAdmin : members)
      .map((row) => row.keycloakSub).join(",") });
  const admin = members.find((row) => memberHas(row, "administrator"));
  const adjacent = instance === "a" ? ["b"] : instance === "b" ? ["a", "c"] : ["b"];
  for (const peer of adjacent) {
    await prisma.partner.upsert({ where: { issuerInstanceId: `nexora-${peer}` },
      create: { id: stableUuid(instance, `partner-${peer}`),
        issuerInstanceId: `nexora-${peer}`, code: `ORG-${peer.toUpperCase()}`,
        displayName: `Nexora ${peer.toUpperCase()}`, status: "active",
        createdBySub: admin.keycloakSub },
      update: { status: "active" } });
  }
  const [product, batch, warehouse] = await Promise.all([
    prisma.productVariant.findFirstOrThrow({ where: { sku: `${instance.toUpperCase()}-P1` } }),
    prisma.batch.findUniqueOrThrow({ where: { id: stableUuid(instance, "batch") } }),
    prisma.warehouse.findUniqueOrThrow({ where: { code: `WH-${instance.toUpperCase()}` } }),
  ]);
  const aiDemoLot = instance === "a" ? await seedAiDemoLot(prisma, admin) : null;
  const manifest = { instanceId: organization.instanceId, organizationId: organization.id,
    productVariantId: product.id, batchId: batch.id, warehouseId: warehouse.id,
    originIssuerInstanceId: batch.originIssuerInstanceId, originLotId: batch.originLotId,
    roles: members.map((row) => row.role).sort(), partnerIssuers: adjacent.map((peer) => `nexora-${peer}`),
    ...(aiDemoLot ? { aiDemoLot } : {}) };
  const destination = resolve(root, "deploy", "instances", instance, "fixture-manifest.json");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Seeded ${manifest.instanceId}; zero-stock fixture manifest: ${destination}`);
} finally {
  await prisma.$disconnect();
}

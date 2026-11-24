// SPDX-License-Identifier: AGPL-3.0-only
// P09-T01: idempotent, zero-stock A/B/C fixture. Run only against named demo projects.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { validateConfig } from "../config.mjs";

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
const project = `nexora-${instance}`;
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
  const members = await prisma.membership.findMany({ where: { status: "active",
    role: { in: ["administrator", "staff", "approver"] } } });
  for (const role of ["administrator", "staff", "approver"]) {
    if (!members.some((row) => row.role === role))
      throw new Error(`Missing demo role ${role}`);
  }
  run("deploy/scripts/seed-catalog.mjs", { ...env,
    SEED_STAFF_SUBS: members.filter((row) => row.role !== "administrator")
      .map((row) => row.keycloakSub).join(",") });
  const admin = members.find((row) => row.role === "administrator");
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
  const manifest = { instanceId: organization.instanceId, organizationId: organization.id,
    productVariantId: product.id, batchId: batch.id, warehouseId: warehouse.id,
    originIssuerInstanceId: batch.originIssuerInstanceId, originLotId: batch.originLotId,
    roles: members.map((row) => row.role).sort(), partnerIssuers: adjacent.map((peer) => `nexora-${peer}`) };
  const destination = resolve(root, "deploy", "instances", instance, "fixture-manifest.json");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Seeded ${manifest.instanceId}; zero-stock fixture manifest: ${destination}`);
} finally {
  await prisma.$disconnect();
}

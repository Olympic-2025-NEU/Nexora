// SPDX-License-Identifier: AGPL-3.0-only
// Fixture-only connection provisioning. Refuses non-demo projects and never stores secrets in PG.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { demoProject } from "./demo-project.mjs";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");
const root = resolve(import.meta.dirname, "../..");
const layouts = [
  { instance: "a", peers: [{ name: "b", outgoing: 1, incoming: 1 }] },
  { instance: "b", peers: [{ name: "a", outgoing: 1, incoming: 1 },
    { name: "c", outgoing: 2, incoming: 2 }] },
  { instance: "c", peers: [{ name: "b", outgoing: 1, incoming: 1 }] },
];
for (const layout of layouts) {
  const path = resolve(root, "deploy", "instances", `${layout.instance}.env`);
  const env = parseEnv(readFileSync(path, "utf8"));
  if (env.INSTANCE_ID !== layout.instance || env.ORG_CODE !== `ORG-${layout.instance.toUpperCase()}`)
    throw new Error(`Demo identity mismatch: ${layout.instance}`);
  const project = demoProject(layout.instance);
  const compose = spawnSync("docker", ["compose", "-f", "deploy/compose.yml",
    "--env-file", path, "-p", project, "ps", "-q", "postgres"],
  { cwd: root, encoding: "utf8" });
  if (compose.status !== 0 || !compose.stdout.trim())
    throw new Error(`Demo PostgreSQL is not running: ${project}`);
  const label = spawnSync("docker", ["inspect", "--format",
    "{{index .Config.Labels \"com.docker.compose.project\"}}", compose.stdout.trim()],
  { encoding: "utf8" });
  if (label.status !== 0 || label.stdout.trim() !== project)
    throw new Error(`Unexpected Compose project: ${project}`);
  const url = new URL(env.MIGRATOR_DATABASE_URL);
  url.hostname = "127.0.0.1";
  url.port = env.POSTGRES_HOST_PORT;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  try {
    const org = await db.organization.findUniqueOrThrow({ where: { singletonSlot: 1 } });
    if (org.instanceId !== `nexora-${layout.instance}`)
      throw new Error(`Database identity mismatch: ${project}`);
    for (const peer of layout.peers) {
      const outgoingId = env[`FEDERATION_OUTBOUND_CLIENT_${peer.outgoing}_ID`];
      const incomingId = env[`FEDERATION_INBOUND_CLIENT_${peer.incoming}_ID`];
      const secret = env[`FEDERATION_OUTBOUND_SECRET_${peer.outgoing}`];
      if (!outgoingId || !incomingId || !secret) throw new Error(`Missing M2M configuration: ${project}`);
      const partner = await db.partner.findUniqueOrThrow({ where: {
        issuerInstanceId: `nexora-${peer.name}` } });
      const data = { endpointUrl: `https://gateway-${peer.name}.nexora.test:9443/api/v1/federation/events`,
        outboundTokenUrl: `https://gateway-${peer.name}.nexora.test:9443/realms/nexora/protocol/openid-connect/token`,
        outboundClientId: outgoingId,
        outboundSecretRef: `env:FEDERATION_OUTBOUND_SECRET_${peer.outgoing}`,
        outboundAudience: "erp-browser", inboundClientId: incomingId,
        allowedInboundScope: "federation:write", status: "active" };
      await db.partnerConnection.upsert({ where: { partnerId: partner.id },
        create: { id: randomUUID(), partnerId: partner.id, ...data }, update: data });
      console.log(`Configured ${project} partner nexora-${peer.name} (secret reference only)`);
    }
  } finally { await db.$disconnect(); }
}

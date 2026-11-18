// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Seed system.organization + system.membership for the Keycloak dev-staff user.
 *
 * Env: KC_BOOTSTRAP_ADMIN_*, KC_DEV_USERNAME, OIDC_BASE_URL, DATABASE_URL, ORG_CODE, INSTANCE_ID
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};

const kcBase = (process.env.OIDC_BASE_URL || "http://keycloak:8080").replace(/\/$/, "");

async function adminToken() {
  const response = await fetch(`${kcBase}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: required("KC_BOOTSTRAP_ADMIN_USERNAME"),
      password: required("KC_BOOTSTRAP_ADMIN_PASSWORD"),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Admin token HTTP ${response.status}`);
  return (await response.json()).access_token;
}

async function userSub(token, username) {
  const response = await fetch(
    `${kcBase}/admin/realms/nexora/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new Error(`List users HTTP ${response.status}`);
  const users = await response.json();
  if (!users.length) throw new Error(`Keycloak user not found: ${username}`);
  return users[0].id;
}

async function main() {
  const token = await adminToken();
  const username = required("KC_DEV_USERNAME");
  const sub = await userSub(token, username);
  const orgCode = required("ORG_CODE");
  const instanceId = required("INSTANCE_ID");
  required("DATABASE_URL");

  const prisma = new PrismaClient();
  try {
    const organization = await prisma.organization.upsert({
      where: { singletonSlot: 1 },
      create: {
        id: randomUUID(),
        singletonSlot: 1,
        instanceId: `nexora-${instanceId}`,
        code: orgCode,
        name: `Nexora Org ${orgCode}`,
        timezone: "Asia/Ho_Chi_Minh",
        status: "active",
      },
      update: { updatedAt: new Date() },
    });

    await prisma.membership.upsert({
      where: { keycloakSub: sub },
      create: {
        id: randomUUID(),
        organizationId: organization.id,
        keycloakSub: sub,
        displayName: username,
        role: "staff",
        status: "active",
        lastSyncedAt: new Date(),
      },
      update: {
        organizationId: organization.id,
        role: "staff",
        status: "active",
        lastSyncedAt: new Date(),
      },
    });

    const fingerprint = createHash("sha256").update(sub).digest("hex").slice(0, 12);
    console.log(`Seeded org ${organization.id}; membership for ${username} sub_fp=${fingerprint}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

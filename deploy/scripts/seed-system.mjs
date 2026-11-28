// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Idempotent seed for system.organization + membership (+ optional partner stubs).
 *
 * Env: KC_BOOTSTRAP_ADMIN_*, KC_DEV_USERNAME, OIDC_BASE_URL, DATABASE_URL, ORG_CODE, INSTANCE_ID
 * Optional: KC_ADMIN_USERNAME (defaults to creating administrator membership for same or separate user)
 * Optional partner stubs (no secrets): SEED_PARTNER_ISSUER, SEED_PARTNER_CODE, SEED_PARTNER_NAME
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};

const kcBase = (process.env.OIDC_BASE_URL || "http://keycloak:8080").replace(/\/$/, "");

/** Legacy seed labels → job-role bundles (ADR 0018). */
function expandSeedRoles(label) {
  switch (label) {
    case "administrator":
      return ["administrator"];
    case "staff":
      return ["catalog_manager", "inventory_clerk", "sales_clerk", "stocktake_clerk"];
    case "approver":
      return ["issue_approver", "auditor"];
    case "viewer":
      return ["auditor"];
    default:
      return [label];
  }
}

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

async function upsertMembership(prisma, organizationId, sub, displayName, roleLabel) {
  const roles = expandSeedRoles(roleLabel);
  const primary = roles[0];
  const row = await prisma.membership.upsert({
    where: { keycloakSub: sub },
    create: {
      id: randomUUID(),
      organizationId,
      keycloakSub: sub,
      displayName,
      role: primary,
      status: "active",
      lastSyncedAt: new Date(),
    },
    update: {
      organizationId,
      displayName,
      role: primary,
      status: "active",
      lastSyncedAt: new Date(),
    },
  });
  await prisma.membershipRoleRow.deleteMany({ where: { membershipId: row.id } });
  await prisma.membershipRoleRow.createMany({
    data: roles.map((role) => ({ membershipId: row.id, role })),
  });
}

async function main() {
  const token = await adminToken();
  const staffUsername = required("KC_DEV_USERNAME");
  const staffSub = await userSub(token, staffUsername);
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

    const adminUsername = process.env.KC_ADMIN_USERNAME || staffUsername;
    let adminSub = staffSub;
    if (adminUsername !== staffUsername) {
      adminSub = await userSub(token, adminUsername);
    }

    await upsertMembership(prisma, organization.id, adminSub, adminUsername, "administrator");
    if (adminSub !== staffSub) {
      await upsertMembership(prisma, organization.id, staffSub, staffUsername, "staff");
    }
    if (process.env.KC_APPROVER_USERNAME) {
      const approverUsername = process.env.KC_APPROVER_USERNAME;
      if (approverUsername === adminUsername || approverUsername === staffUsername)
        throw new Error("Approver must be a distinct user");
      const approverSub = await userSub(token, approverUsername);
      await upsertMembership(prisma, organization.id, approverSub, approverUsername, "approver");
    }

    const partnerIssuer = process.env.SEED_PARTNER_ISSUER;
    const partnerCode = process.env.SEED_PARTNER_CODE;
    const partnerName = process.env.SEED_PARTNER_NAME;
    if (partnerIssuer && partnerCode && partnerName) {
      await prisma.partner.upsert({
        where: { issuerInstanceId: partnerIssuer },
        create: {
          id: randomUUID(),
          issuerInstanceId: partnerIssuer,
          code: partnerCode,
          displayName: partnerName,
          status: "active",
          createdBySub: adminSub,
        },
        update: {
          code: partnerCode,
          displayName: partnerName,
          updatedAt: new Date(),
        },
      });
      console.log(`Seeded partner stub code=${partnerCode} (no connection secrets)`);
    }

    const fingerprint = createHash("sha256").update(adminSub).digest("hex").slice(0, 12);
    console.log(
      `Seeded org ${organization.id}; administrator sub_fp=${fingerprint}; job roles via membership_role (ADR 0018)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

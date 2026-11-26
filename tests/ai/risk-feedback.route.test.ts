// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { alertFingerprint } from "@/contexts/ai/application/risk-rules";

const sub = "risk-feedback-staff";
const issuer = "https://issuer.test";
const audience = "nexora";
const jwksUrl = "http://localhost/risk-feedback-jwks";
const batchId = "11111111-1111-4111-8111-111111111111";
const sentId = "22222222-2222-4222-8222-222222222222";

function feedbackRequest(token: string, alertFingerprint: string, verdict: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/ai/risk/feedback", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
      "x-request-id": "risk-feedback-1" },
    body: JSON.stringify({
      alertFingerprint, ruleId: "NEAR_EXPIRY", ruleVersion: "risk-v1", verdict,
      actorId: "attacker", status: "confirmed",
    }),
  });
}

test("POST /api/v1/ai/risk/feedback ghi đúng một audit entry, không đổi stock/status", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "risk-feedback-key";
  const root = globalThis as typeof globalThis & { nexoraPrisma?: unknown };
  const savedPrisma = root.nexoraPrisma;
  const savedFetch = globalThis.fetch;
  const savedEnv = {
    OIDC_JWKS_URL: process.env.OIDC_JWKS_URL,
    OIDC_ISSUER_URL: process.env.OIDC_ISSUER_URL,
    OIDC_AUDIENCE: process.env.OIDC_AUDIENCE,
  };
  const audits: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const blockWrite = async (name: string): Promise<never> => {
    writes.push(name);
    throw new Error(`write blocked: ${name}`);
  };
  const tx = {
    auditLog: { async create({ data }: { data: Record<string, unknown> }) {
      audits.push(data);
      return data;
    } },
    stockBalance: { update: () => blockWrite("stockBalance"), create: () => blockWrite("stockBalance") },
    stockMovement: { create: () => blockWrite("stockMovement") },
    batch: { update: () => blockWrite("batch") },
  };
  try {
    root.nexoraPrisma = {
      membership: { async findUnique() {
        return { id: "membership-1", organizationId: "org-a", keycloakSub: sub,
          displayName: "Staff", role: "staff", status: "active", warehouses: [] };
      } },
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === jwksUrl) {
        return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }) as typeof fetch;
    process.env.OIDC_JWKS_URL = jwksUrl;
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_AUDIENCE = audience;
    const requireFromTest = createRequire(__filename);
    const { POST } = requireFromTest("../../app/api/v1/ai/risk/feedback/route") as typeof import(
      "../../app/api/v1/ai/risk/feedback/route"
    );
    const token = await new SignJWT({ realm_access: { roles: ["staff"] } })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(sub).setIssuer(issuer).setAudience(audience)
      .setExpirationTime("1h").sign(privateKey);
    const fingerprint = await alertFingerprint({
      ruleId: "NEAR_EXPIRY", ruleVersion: "risk-v1", sourceIds: [sentId, batchId],
    });
    const response = await POST(feedbackRequest(token, fingerprint, "correct"));
    assert.equal(response.status, 200);
    const body = await response.json() as { data: Record<string, unknown>; requestId: string };
    assert.equal(body.requestId, "risk-feedback-1");
    assert.equal(body.data.alertFingerprint, fingerprint);
    assert.equal(body.data.actorId, sub);
    assert.equal(JSON.stringify(body).includes("attacker"), false);
    assert.equal(audits.length, 1);
    assert.deepEqual(writes, []);
    const audit = audits[0]!;
    assert.equal(audit.action, "ai.risk.feedback");
    assert.equal(audit.actorSub, sub);
    assert.equal(audit.targetType, "ai_risk_alert");
    assert.equal(audit.targetId, fingerprint);
    assert.equal(audit.requestId, "risk-feedback-1");
    assert.deepEqual(audit.afterSummary, {
      alertFingerprint: fingerprint, ruleId: "NEAR_EXPIRY", ruleVersion: "risk-v1",
      verdict: "correct", actorId: sub,
    });
    assert.equal(JSON.stringify(audit).includes("attacker"), false);
    assert.equal(JSON.stringify(audit).includes("confirmed"), false);
    const invalid = new NextRequest("http://localhost/api/v1/ai/risk/feedback", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ alertFingerprint: fingerprint, ruleId: "NEAR_EXPIRY",
        ruleVersion: "risk-v1", verdict: "maybe" }),
    });
    assert.equal((await POST(invalid)).status, 422);
    assert.equal(audits.length, 1);
    assert.deepEqual(writes, []);
  } finally {
    root.nexoraPrisma = savedPrisma;
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

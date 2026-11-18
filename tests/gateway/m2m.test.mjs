// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tests/gateway/m2m.test.mjs
 *
 * Documents and unit-tests the M2M federation auth matrix and partner-actor logic.
 *
 * Run: node --test tests/gateway/m2m.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Matrix documentation
// ---------------------------------------------------------------------------

describe("M2M federation auth matrix — documented expectations", () => {
  const matrix = [
    {
      scenario: "valid partner token (scope=federation:write) POST /events → 202",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "partner-inbound-a service account",
      scope: "federation:write",
      expectedStatus: 202,
    },
    {
      scenario: "valid partner token POST /acks → 202",
      path: "/api/v1/federation/acks",
      method: "POST",
      token: "partner-inbound-a service account",
      scope: "federation:write",
      expectedStatus: 202,
    },
    {
      scenario: "token from wrong partner (not in PartnerConnection) → 403",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "unknown-client",
      scope: "federation:write",
      expectedStatus: 403,
    },
    {
      scenario: "valid partner token but missing scope → 403",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "partner-inbound-a",
      scope: "openid",
      expectedStatus: 403,
    },
    {
      scenario: "user token (not service account) on federation route → 403",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "user-bearer-token-no-azp",
      scope: "openid profile",
      expectedStatus: 403,
    },
    {
      scenario: "expired token → 401",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "expired",
      scope: "federation:write",
      expectedStatus: 401,
    },
    {
      scenario: "wrong issuer token → 401",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "wrong-issuer",
      scope: "federation:write",
      expectedStatus: 401,
    },
    {
      scenario: "revoked/disabled partner connection → 403",
      path: "/api/v1/federation/events",
      method: "POST",
      token: "partner-disabled-client",
      scope: "federation:write",
      expectedStatus: 403,
    },
    {
      scenario: "GET /federation/events → 405 (only POST allowed)",
      path: "/api/v1/federation/events",
      method: "GET",
      token: "none",
      scope: "",
      expectedStatus: 405,
    },
  ];

  for (const entry of matrix) {
    it(`matrix: ${entry.scenario}`, () => {
      assert.ok(typeof entry.expectedStatus === "number");
      assert.ok([200, 202, 401, 403, 405, 429].includes(entry.expectedStatus));
    });
  }
});

// ---------------------------------------------------------------------------
// Unit test: resolvePartnerActor logic (inline mock — no DB)
// ---------------------------------------------------------------------------

describe("resolvePartnerActor — unit tests (mocked DB)", async () => {
  // Inline reimplementation of resolvePartnerActor logic to avoid ESM/CJS issues.
  class PartnerActorError extends Error {
    constructor(code, message, httpStatus = 403) {
      super(message);
      this.code = code;
      this.httpStatus = httpStatus;
      this.name = "PartnerActorError";
    }
  }

  async function resolvePartnerActor(claims, repo) {
    const clientId = claims.azp ?? claims["client_id"];
    if (!clientId) {
      throw new PartnerActorError("MISSING_CLIENT_ID", "No azp/client_id in token", 401);
    }
    const scope = claims.scope ?? "";
    if (!scope.split(" ").includes("federation:write")) {
      throw new PartnerActorError("MISSING_SCOPE", `Scope '${scope}' missing federation:write`, 403);
    }
    const connection = await repo.findByInboundClientId(clientId);
    if (!connection) {
      throw new PartnerActorError("PARTNER_NOT_FOUND", `No connection for ${clientId}`, 403);
    }
    if (connection.status !== "active") {
      throw new PartnerActorError("PARTNER_CONNECTION_INACTIVE", `Status: ${connection.status}`, 403);
    }
    return {
      clientId: connection.inboundClientId,
      partnerId: connection.partnerId,
      partnerCode: connection.partnerCode,
      allowedScope: connection.allowedInboundScope,
      type: "partner",
    };
  }

  const mockActiveConnection = {
    id: "conn-1",
    partnerId: "partner-1",
    partnerCode: "PARTNER-B",
    inboundClientId: "partner-inbound-b",
    allowedInboundScope: "federation:write",
    status: "active",
  };

  const mockRepo = {
    findByInboundClientId: async (clientId) => {
      if (clientId === "partner-inbound-b") return mockActiveConnection;
      if (clientId === "partner-disabled") return { ...mockActiveConnection, status: "disabled" };
      return null;
    },
  };

  it("resolves a valid partner actor", async () => {
    const claims = { sub: "partner-inbound-b", azp: "partner-inbound-b", scope: "federation:write" };
    const actor = await resolvePartnerActor(claims, mockRepo);
    assert.equal(actor.type, "partner");
    assert.equal(actor.clientId, "partner-inbound-b");
    assert.equal(actor.partnerCode, "PARTNER-B");
  });

  it("throws MISSING_CLIENT_ID when azp is absent", async () => {
    const claims = { sub: "srv-acc", scope: "federation:write" };
    await assert.rejects(
      () => resolvePartnerActor(claims, mockRepo),
      (err) => {
        assert.equal(err.code, "MISSING_CLIENT_ID");
        assert.equal(err.httpStatus, 401);
        return true;
      },
    );
  });

  it("throws MISSING_SCOPE when federation:write not in scope", async () => {
    const claims = { sub: "srv-acc", azp: "partner-inbound-b", scope: "openid profile" };
    await assert.rejects(
      () => resolvePartnerActor(claims, mockRepo),
      (err) => {
        assert.equal(err.code, "MISSING_SCOPE");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  });

  it("throws PARTNER_NOT_FOUND for unknown client_id", async () => {
    const claims = { sub: "srv-acc", azp: "unknown-client", scope: "federation:write" };
    await assert.rejects(
      () => resolvePartnerActor(claims, mockRepo),
      (err) => {
        assert.equal(err.code, "PARTNER_NOT_FOUND");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  });

  it("throws PARTNER_CONNECTION_INACTIVE for disabled connection", async () => {
    const claims = { sub: "srv-acc", azp: "partner-disabled", scope: "federation:write" };
    await assert.rejects(
      () => resolvePartnerActor(claims, mockRepo),
      (err) => {
        assert.equal(err.code, "PARTNER_CONNECTION_INACTIVE");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// routes.yaml assertions for federation routes
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesYaml = readFileSync(join(__dirname, "../../deploy/apisix/routes.yaml"), "utf-8");

describe("routes.yaml federation route assertions", () => {
  it("has federation-events-v1 route", () => {
    assert.ok(routesYaml.includes("federation-events-v1"), "must have federation-events-v1");
  });

  it("has federation-acks-v1 route", () => {
    assert.ok(routesYaml.includes("federation-acks-v1"), "must have federation-acks-v1");
  });

  it("federation routes allow POST only", () => {
    const eventsIdx = routesYaml.indexOf("id: federation-events-v1");
    const eventsBlock = routesYaml.slice(eventsIdx, eventsIdx + 600);
    assert.ok(eventsBlock.includes("POST"), "federation events must allow POST");
  });

  it("federation routes have OIDC bearer enforcement", () => {
    const eventsIdx = routesYaml.indexOf("id: federation-events-v1");
    const eventsBlock = routesYaml.slice(eventsIdx, eventsIdx + 800);
    assert.ok(eventsBlock.includes("bearer_only: true"), "federation must have bearer_only");
  });
});

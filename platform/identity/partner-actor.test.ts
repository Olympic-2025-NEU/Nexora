// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PartnerActorError, resolvePartnerActor } from "./partner-actor";

const baseClaims = {
  sub: "service-account",
  iss: "http://keycloak/realms/nexora",
  aud: "account",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  azp: "partner-inbound-a",
  scope: "federation:write",
};

describe("resolvePartnerActor P05 harden", () => {
  it("rejects missing client id", async () => {
    await assert.rejects(
      () =>
        resolvePartnerActor({ ...baseClaims, azp: undefined, client_id: undefined }, {
          async findByInboundClientId() {
            return null;
          },
        }),
      (err: unknown) => err instanceof PartnerActorError && err.code === "MISSING_CLIENT_ID",
    );
  });

  it("rejects suspended partner even if connection active", async () => {
    await assert.rejects(
      () =>
        resolvePartnerActor(baseClaims, {
          async findByInboundClientId() {
            return {
              id: "c1",
              partnerId: "p1",
              partnerCode: "ORG-B",
              partnerStatus: "suspended",
              inboundClientId: "partner-inbound-a",
              allowedInboundScope: "federation:write",
              status: "active",
            };
          },
        }),
      (err: unknown) => err instanceof PartnerActorError && err.code === "PARTNER_SUSPENDED",
    );
  });

  it("accepts active partner + connection", async () => {
    const actor = await resolvePartnerActor(baseClaims, {
      async findByInboundClientId() {
        return {
          id: "c1",
          partnerId: "p1",
          partnerCode: "ORG-B",
          partnerStatus: "active",
          inboundClientId: "partner-inbound-a",
          allowedInboundScope: "federation:write",
          status: "active",
        };
      },
    });
    assert.equal(actor.partnerCode, "ORG-B");
    assert.equal(actor.type, "partner");
  });
});

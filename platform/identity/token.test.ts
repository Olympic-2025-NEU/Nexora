// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for platform/identity/token.ts
 *
 * Uses node:test + jose to mint real JWTs against an in-memory RSA key.
 * No network calls — JWKS endpoint is mocked via jose createLocalJWKSet.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { realmRoles, TokenError, type NexoraClaims } from "./token.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestKeys {
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
}

async function generateTestKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicJwk };
}

async function mintToken(
  privateKey: CryptoKey,
  claims: Partial<NexoraClaims> & { sub: string },
  {
    issuer = "https://keycloak.localhost/realms/nexora",
    audience = "nexora-api",
    expiresIn = "1h",
  } = {},
): Promise<string> {
  return new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

/**
 * Minimal verifier that uses createLocalJWKSet instead of a remote URL.
 * Mirrors verifyBearerToken logic without the fetch dependency.
 */
async function verifyLocal(
  authHeader: string | undefined | null,
  jwks: ReturnType<typeof createLocalJWKSet>,
  options: { issuer: string; audience: string },
): Promise<NexoraClaims> {
  const { jwtVerify } = await import("jose");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new TokenError("MISSING_BEARER", "Authorization header must be Bearer <token>", 401);
  }
  const token = authHeader.slice(7);
  const { payload } = await jwtVerify<NexoraClaims>(token, jwks, {
    issuer: options.issuer,
    audience: options.audience,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TokenError("INVALID_TOKEN", msg, 401);
  });
  if (!payload.sub) {
    throw new TokenError("MISSING_SUB", "Token has no sub claim", 401);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("token claim validation", async () => {
  const { privateKey, publicJwk } = await generateTestKeys();
  const ISSUER = "https://keycloak.localhost/realms/nexora";
  const AUDIENCE = "nexora-api";
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });
  const opts = { issuer: ISSUER, audience: AUDIENCE };

  it("accepts a valid token and returns claims", async () => {
    const jwt = await mintToken(privateKey, {
      sub: "user-abc",
      realm_access: { roles: ["staff"] },
      email: "alice@example.com",
    });
    const claims = await verifyLocal(`Bearer ${jwt}`, jwks, opts);
    assert.equal(claims.sub, "user-abc");
    assert.deepEqual(claims.realm_access?.roles, ["staff"]);
  });

  it("throws TokenError 401 when Authorization header is missing", async () => {
    await assert.rejects(
      () => verifyLocal(undefined, jwks, opts),
      (err: unknown) => {
        assert.ok(err instanceof TokenError);
        assert.equal((err as TokenError).code, "MISSING_BEARER");
        assert.equal((err as TokenError).httpStatus, 401);
        return true;
      },
    );
  });

  it("throws TokenError 401 when Authorization header lacks Bearer prefix", async () => {
    const jwt = await mintToken(privateKey, { sub: "user-abc" });
    await assert.rejects(
      () => verifyLocal(`Basic ${jwt}`, jwks, opts),
      (err: unknown) => {
        assert.ok(err instanceof TokenError);
        assert.equal((err as TokenError).code, "MISSING_BEARER");
        return true;
      },
    );
  });

  it("throws TokenError 401 for an expired token", async () => {
    // Sign with an expiry in the past (Unix timestamp - 60 s).
    const { SignJWT: SignJWT2 } = await import("jose");
    const expiredJwt = await new SignJWT2({ sub: "user-exp" } as Record<string, unknown>)
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);
    await assert.rejects(
      () => verifyLocal(`Bearer ${expiredJwt}`, jwks, opts),
      (err: unknown) => {
        assert.ok(err instanceof TokenError);
        assert.equal((err as TokenError).httpStatus, 401);
        return true;
      },
    );
  });

  it("throws TokenError 401 for wrong issuer", async () => {
    const jwt = await mintToken(
      privateKey,
      { sub: "user-iss" },
      { issuer: "https://evil.example.com/realms/nexora" },
    );
    await assert.rejects(
      () => verifyLocal(`Bearer ${jwt}`, jwks, opts),
      (err: unknown) => {
        assert.ok(err instanceof TokenError);
        assert.equal((err as TokenError).httpStatus, 401);
        return true;
      },
    );
  });

  it("throws TokenError 401 for wrong audience", async () => {
    const jwt = await mintToken(
      privateKey,
      { sub: "user-aud" },
      { audience: "wrong-service" },
    );
    await assert.rejects(
      () => verifyLocal(`Bearer ${jwt}`, jwks, opts),
      (err: unknown) => {
        assert.ok(err instanceof TokenError);
        assert.equal((err as TokenError).httpStatus, 401);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// realmRoles helper tests
// ---------------------------------------------------------------------------

describe("realmRoles", () => {
  it("returns roles from realm_access.roles", () => {
    const claims: NexoraClaims = {
      sub: "u1",
      realm_access: { roles: ["administrator", "viewer"] },
    };
    assert.deepEqual(realmRoles(claims), ["administrator", "viewer"]);
  });

  it("returns empty array when realm_access is absent", () => {
    const claims: NexoraClaims = { sub: "u2" };
    assert.deepEqual(realmRoles(claims), []);
  });
});

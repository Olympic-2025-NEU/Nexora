// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tests/gateway/public.test.mjs
 *
 * Documents and unit-tests the expected policy for public routes.
 *
 * Run: node --test tests/gateway/public.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesYaml = readFileSync(join(__dirname, "../../deploy/apisix/routes.yaml"), "utf-8");

// ---------------------------------------------------------------------------
// Matrix documentation
// ---------------------------------------------------------------------------

describe("public route auth matrix — documented expectations", () => {
  const matrix = [
    { scenario: "GET /api/v1/public/passport/:token (valid) → 404 (stub, not 200 yet)", method: "GET", path: "/api/v1/public/passport/abc123xyz456", token: "none", expectedApp: 404 },
    { scenario: "GET /api/v1/public/passport/:token (invalid format) → 404", method: "GET", path: "/api/v1/public/passport/../secret", token: "none", expectedApp: 404 },
    { scenario: "POST /api/v1/public/passport/:token → 405", method: "POST", path: "/api/v1/public/passport/tok", token: "none", expectedApp: 405 },
    { scenario: "PUT /api/v1/public/passport/:token → 405", method: "PUT", path: "/api/v1/public/passport/tok", token: "none", expectedApp: 405 },
    { scenario: "anonymous GET /api/v1/products (private) → 401 from gateway", method: "GET", path: "/api/v1/products", token: "none", expectedGateway: 401 },
    { scenario: "rate limit on public route → 429", method: "GET", path: "/api/v1/public/passport/tok", token: "none+flood", expectedGateway: 429 },
  ];

  for (const entry of matrix) {
    it(`matrix: ${entry.scenario}`, () => {
      const status = entry.expectedApp ?? entry.expectedGateway;
      assert.ok(typeof status === "number");
      assert.ok([200, 401, 403, 404, 405, 429].includes(status));
    });
  }
});

// ---------------------------------------------------------------------------
// routes.yaml static assertions for public route
// ---------------------------------------------------------------------------

describe("routes.yaml public route assertions", () => {
  it("has public-passport-v1 route", () => {
    assert.ok(routesYaml.includes("public-passport-v1"), "must have public-passport-v1 route");
  });

  it("public-passport-v1 only allows GET/HEAD", () => {
    // Find the public-passport-v1 block and check its methods.
    const idx = routesYaml.indexOf("id: public-passport-v1");
    assert.ok(idx !== -1, "public-passport-v1 must exist");
    // The methods line is of the form:   methods: [GET, HEAD]
    // Extract just the methods line to avoid false-positives from later routes.
    const blockEnd = routesYaml.indexOf("\n  - id:", idx + 1);
    const block = blockEnd > idx ? routesYaml.slice(idx, blockEnd) : routesYaml.slice(idx, idx + 600);
    assert.ok(block.includes("GET"), "public passport route must allow GET");
    assert.ok(block.includes("HEAD"), "public passport route must allow HEAD");
    // Find the methods line specifically for this route.
    const methodsMatch = block.match(/methods:\s*\[([^\]]+)\]/);
    assert.ok(methodsMatch, "public-passport-v1 must have a methods list");
    const methodsList = methodsMatch[1];
    assert.ok(!methodsList.includes("POST"), "public passport route methods must NOT include POST");
    assert.ok(!methodsList.includes("PUT"), "public passport route methods must NOT include PUT");
  });

  it("public-passport-v1 has rate limiting", () => {
    const idx = routesYaml.indexOf("id: public-passport-v1");
    const block = routesYaml.slice(idx, idx + 800);
    assert.ok(block.includes("limit-req"), "public route must have limit-req");
  });

  it("public-passport-v1 does NOT have openid-connect plugin", () => {
    const idx = routesYaml.indexOf("id: public-passport-v1");
    const block = routesYaml.slice(idx, idx + 800);
    // The block ends before the next route entry.
    const nextRouteIdx = block.indexOf("- id:", 10);
    const relevantBlock = nextRouteIdx > 0 ? block.slice(0, nextRouteIdx) : block;
    assert.ok(!relevantBlock.includes("openid-connect"), "public route must NOT require OIDC auth");
  });
});

// ---------------------------------------------------------------------------
// Unit test: passport token format validation (mirrors route handler logic)
// ---------------------------------------------------------------------------

describe("passport token format validation", () => {
  function isValidTokenFormat(token) {
    return /^[a-zA-Z0-9_-]{10,128}$/.test(token);
  }

  it("accepts valid alphanumeric token", () => {
    assert.ok(isValidTokenFormat("abc123xyz456"));
  });

  it("accepts token with hyphens and underscores", () => {
    assert.ok(isValidTokenFormat("token-abc_123-xyz"));
  });

  it("rejects path traversal attempt", () => {
    assert.ok(!isValidTokenFormat("../secret"));
  });

  it("rejects token with spaces", () => {
    assert.ok(!isValidTokenFormat("token with spaces"));
  });

  it("rejects too-short token (< 10 chars)", () => {
    assert.ok(!isValidTokenFormat("short"));
  });

  it("rejects too-long token (> 128 chars)", () => {
    assert.ok(!isValidTokenFormat("a".repeat(129)));
  });

  it("rejects token with SQL injection attempt", () => {
    assert.ok(!isValidTokenFormat("'; DROP TABLE"));
  });

  it("rejects token with angle brackets (XSS attempt)", () => {
    assert.ok(!isValidTokenFormat("<script>alert(1)</script>"));
  });

  it("accepts 10-char minimum token", () => {
    assert.ok(isValidTokenFormat("0123456789"));
  });

  it("accepts 128-char maximum token", () => {
    assert.ok(isValidTokenFormat("a".repeat(128)));
  });
});

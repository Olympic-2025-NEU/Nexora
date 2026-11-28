// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route";

function withDevLoginEnv(run: () => Promise<void>) {
  return async () => {
    const originalFetch = globalThis.fetch;
    const originalAllow = process.env.ALLOW_DEV_PASSWORD_LOGIN;
    const originalBase = process.env.OIDC_BASE_URL;
    try {
      process.env.ALLOW_DEV_PASSWORD_LOGIN = "true";
      process.env.OIDC_BASE_URL = "http://keycloak:8080";
      await run();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalAllow === undefined) delete process.env.ALLOW_DEV_PASSWORD_LOGIN;
      else process.env.ALLOW_DEV_PASSWORD_LOGIN = originalAllow;
      if (originalBase === undefined) delete process.env.OIDC_BASE_URL;
      else process.env.OIDC_BASE_URL = originalBase;
    }
  };
}

test(
  "local password login forwards a supplied TOTP and rejects malformed codes",
  withDevLoginEnv(async () => {
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const form = init?.body as URLSearchParams;
      assert.equal(form.get("grant_type"), "password");
      assert.equal(form.get("totp"), "123456");
      return new Response(JSON.stringify({ access_token: "fixture-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const valid = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({
          username: "approver",
          password: "local-fixture",
          totp: "123456",
        }),
      }),
    );
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).data.accessToken, "fixture-token");
    const malformed = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({
          username: "approver",
          password: "local-fixture",
          totp: "12x456",
        }),
      }),
    );
    assert.equal(malformed.status, 400);
    assert.equal(calls, 1);
  }),
);

test(
  "password login without totp returns MFA_REQUIRED when Keycloak signals MFA",
  withDevLoginEnv(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Missing totp authenticator",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );

    const res = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "secret" }),
      }),
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, "MFA_REQUIRED");
    assert.equal(json.detail, "Missing totp authenticator");
    assert.equal(json.message, "Missing totp authenticator");
  }),
);

test(
  "password login succeeds without totp when Keycloak issues tokens",
  withDevLoginEnv(async () => {
    globalThis.fetch = async (_input, init) => {
      const form = init?.body as URLSearchParams;
      assert.equal(form.get("grant_type"), "password");
      assert.equal(form.get("username"), "staff");
      assert.equal(form.has("totp"), false);
      return new Response(
        JSON.stringify({
          access_token: "staff-token",
          refresh_token: "staff-refresh",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const res = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({ username: "staff", password: "local-fixture" }),
      }),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.accessToken, "staff-token");
    assert.equal(json.data.refreshToken, "staff-refresh");
  }),
);

test(
  "password login succeeds with totp when Keycloak issues tokens",
  withDevLoginEnv(async () => {
    globalThis.fetch = async (_input, init) => {
      const form = init?.body as URLSearchParams;
      assert.equal(form.get("totp"), "654321");
      return new Response(
        JSON.stringify({ access_token: "mfa-token", refresh_token: "mfa-refresh" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const res = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({
          username: "approver",
          password: "local-fixture",
          totp: "654321",
        }),
      }),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.accessToken, "mfa-token");
  }),
);

test(
  "wrong totp does not map to MFA_REQUIRED",
  withDevLoginEnv(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid totp authenticator",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );

    const res = await POST(
      new Request("http://localhost/auth/dev-token", {
        method: "POST",
        body: JSON.stringify({
          username: "approver",
          password: "local-fixture",
          totp: "000000",
        }),
      }),
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.notEqual(json.error, "MFA_REQUIRED");
    assert.equal(json.error, "invalid_grant");
    assert.equal(json.message, "Invalid totp authenticator");
  }),
);

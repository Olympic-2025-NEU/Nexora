// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route";

test("local password login forwards a supplied TOTP and rejects malformed codes", async () => {
  const originalFetch = globalThis.fetch;
  const originalAllow = process.env.ALLOW_DEV_PASSWORD_LOGIN;
  const originalBase = process.env.OIDC_BASE_URL;
  let calls = 0;
  try {
    process.env.ALLOW_DEV_PASSWORD_LOGIN = "true";
    process.env.OIDC_BASE_URL = "http://keycloak:8080";
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const form = init?.body as URLSearchParams;
      assert.equal(form.get("grant_type"), "password");
      assert.equal(form.get("totp"), "123456");
      return new Response(JSON.stringify({ access_token: "fixture-token" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    const valid = await POST(new Request("http://localhost/auth/dev-token", { method: "POST",
      body: JSON.stringify({ username: "approver", password: "local-fixture", totp: "123456" }) }));
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).data.accessToken, "fixture-token");
    const malformed = await POST(new Request("http://localhost/auth/dev-token", { method: "POST",
      body: JSON.stringify({ username: "approver", password: "local-fixture", totp: "12x456" }) }));
    assert.equal(malformed.status, 400);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAllow === undefined) delete process.env.ALLOW_DEV_PASSWORD_LOGIN;
    else process.env.ALLOW_DEV_PASSWORD_LOGIN = originalAllow;
    if (originalBase === undefined) delete process.env.OIDC_BASE_URL;
    else process.env.OIDC_BASE_URL = originalBase;
  }
});

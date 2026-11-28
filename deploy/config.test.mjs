// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateConfig } from "./config.mjs";
import { demoProject } from "./scripts/demo-project.mjs";

const examples = ["a", "b", "c"].map((instance) => {
  const text = readFileSync(new URL(`./instances/${instance}.env.example`, import.meta.url), "utf8")
    .replace(/CHANGE_ME_[A-Z0-9_]+/g, (marker) => marker.replace("CHANGE_ME_", "localonly_"));
  return parseEnv(text);
});

test("G09 project prefix is isolated and allowlisted", () => {
  const previous = process.env.NEXORA_DEMO_PROJECT_PREFIX;
  try {
    delete process.env.NEXORA_DEMO_PROJECT_PREFIX;
    assert.equal(demoProject("a"), "nexora-a");
    process.env.NEXORA_DEMO_PROJECT_PREFIX = "nexora-g09";
    assert.equal(demoProject("b"), "nexora-g09-b");
    process.env.NEXORA_DEMO_PROJECT_PREFIX = "production";
    assert.throws(() => demoProject("c"), /Unsupported demo project prefix/);
    assert.throws(() => demoProject("other"), /Expected a\|b\|c/);
  } finally {
    if (previous === undefined) delete process.env.NEXORA_DEMO_PROJECT_PREFIX;
    else process.env.NEXORA_DEMO_PROJECT_PREFIX = previous;
  }
});

test("all instance contracts parse and isolate ports, buckets and credentials", () => {
  for (const env of examples) validateConfig(env);
  for (const field of ["GATEWAY_HTTP_PORT", "GATEWAY_HTTPS_PORT", "POSTGRES_HOST_PORT",
    "KEYCLOAK_HOST_PORT", "FLOWABLE_HOST_PORT", "OIDC_ISSUER_URL", "S3_BUCKET_PRIVATE",
    "POSTGRES_PASSWORD", "ORG_CODE"]) {
    assert.equal(new Set(examples.map((env) => env[field])).size, 3, field);
  }
  const ports = examples.flatMap((env) => ["GATEWAY_HTTP_PORT", "GATEWAY_HTTPS_PORT",
    "POSTGRES_HOST_PORT", "KEYCLOAK_HOST_PORT", "FLOWABLE_HOST_PORT"].map((key) => env[key]));
  assert.equal(new Set(ports).size, ports.length, "A/B/C host ports must not collide");
  for (const env of examples) assert.equal(env.APISIX_RENDERED_PATH,
    `./instances/${env.INSTANCE_ID}/apisix.generated.yaml`);
});

test("HTTPS PUBLIC_BASE_URL must match GATEWAY_HTTPS_PORT", () => {
  const httpsPort = examples[0].GATEWAY_HTTPS_PORT;
  const httpPort = examples[0].GATEWAY_HTTP_PORT;
  const env = {
    ...examples[0],
    PUBLIC_BASE_URL: `https://localhost:${httpsPort}`,
    OIDC_REDIRECT_URI_ERP: `https://localhost:${httpsPort}/erp/callback`,
    OIDC_REDIRECT_URI_DXLAB: `https://localhost:${httpsPort}/dxlab/callback`,
  };
  validateConfig(env);
  const mismatched = {
    ...env,
    PUBLIC_BASE_URL: `https://localhost:${httpPort}`,
    OIDC_REDIRECT_URI_ERP: `https://localhost:${httpPort}/erp/callback`,
    OIDC_REDIRECT_URI_DXLAB: `https://localhost:${httpPort}/dxlab/callback`,
  };
  assert.throws(() => validateConfig(mismatched), { message: "Invalid or missing GATEWAY_HTTPS_PORT" });
});

test("browser issuer and private Keycloak discovery stay separate in the A/B/C demo", () => {
  for (const env of examples) {
    assert.equal(env.OIDC_FRONTEND_URL, `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}`);
    assert.equal(env.OIDC_ISSUER_URL, `${env.OIDC_FRONTEND_URL}/realms/nexora`);
    assert.equal(env.OIDC_JWKS_URL,
      `${env.OIDC_BASE_URL}/realms/nexora/protocol/openid-connect/certs`);
    validateConfig(env);
  }
  assert.throws(() => validateConfig({ ...examples[0], OIDC_BACKCHANNEL_DYNAMIC: "false" }),
    { message: "Invalid or missing OIDC_BACKCHANNEL_DYNAMIC" });
  assert.throws(() => validateConfig({ ...examples[0], OIDC_FRONTEND_URL: "http://public.example" }),
    { message: "Invalid or missing OIDC_FRONTEND_URL" });
  assert.throws(() => validateConfig({ ...examples[0], OIDC_ISSUER_URL: examples[0].OIDC_BASE_URL + "/realms/nexora" }),
    { message: "Invalid or missing OIDC_ISSUER_URL" });
});

for (const field of [
  "INSTANCE_ID", "APP_DATABASE_URL", "OIDC_ISSUER_URL", "PARTNER_OUTBOUND_TOKEN_URL",
  "S3_BUCKET_PRIVATE", "FLOWABLE_BASE_URL", "FLOWABLE_HOST_PORT", "REDIS_URL", "AI_BASE_URL",
]) {
  test(`${field}: missing and malformed values report name only`, () => {
    for (const value of [undefined, "invalid-DO_NOT_PRINT_THIS_VALUE"]) {
      const env = { ...examples[0] };
      if (value === undefined) delete env[field];
      else env[field] = value;
      assert.throws(() => validateConfig(env), (error) => {
        assert.equal(error.message, `Invalid or missing ${field}`);
        assert.ok(!error.message.includes("DO_NOT_PRINT_THIS_VALUE"));
        return true;
      });
    }
  });
}

test("runtime processes fail before serving with named missing variables", () => {
  for (const [service, field] of [["erp", "DATABASE_URL"], ["worker", "REDIS_URL"], ["core-data", "S3_SECRET_KEY"]]) {
    const env = { ...examples[0], DATABASE_URL: examples[0].APP_DATABASE_URL,
      NEXORA_ISSUER_INSTANCE_ID: examples[0].INSTANCE_ID };
    validateConfig(env, service);
    delete env[field];
    assert.throws(() => validateConfig(env, service), { message: `Invalid or missing ${field}` });
  }
});

test("Flowable port and REST contract are fixed", () => {
  for (const field of ["FLOWABLE_DB_PASSWORD", "FLOWABLE_ADMIN_USER", "FLOWABLE_ADMIN_PASSWORD"]) {
    const env = { ...examples[0] };
    delete env[field];
    assert.throws(() => validateConfig(env), { message: `Invalid or missing ${field}` });
  }
  assert.throws(() => validateConfig({ ...examples[0], FLOWABLE_HOST_PORT: examples[0].KEYCLOAK_HOST_PORT }), { message: "Invalid or missing FLOWABLE_HOST_PORT" });
  assert.throws(() => validateConfig({ ...examples[0], FLOWABLE_PROCESS_KEY: "other" }), { message: "Invalid or missing FLOWABLE_BASE_URL" });
  assert.throws(() => validateConfig({ ...examples[0], FLOWABLE_ADMIN_USER: "rest-admin", FLOWABLE_ADMIN_PASSWORD: "test" }), { message: "Invalid or missing FLOWABLE_ADMIN_PASSWORD" });
});

test("optional local AI requires its own internal secret and forbids unknown providers", () => {
  assert.throws(() => validateConfig({ ...examples[0], AI_KEY_REF: "invalid" }), { message: "Invalid or missing AI_KEY_REF" });
  assert.throws(() => validateConfig({ ...examples[0], AI_PROVIDER: "external" }), { message: "Invalid or missing AI_PROVIDER" });
  assert.throws(() => validateConfig({ ...examples[0], AI_PROVIDER: "ollama" }), { message: "Invalid or missing AI_INTERNAL_TOKEN" });
  assert.doesNotThrow(() => validateConfig({ ...examples[0], AI_PROVIDER: "ollama", AI_INTERNAL_TOKEN: "a".repeat(32) }));
  assert.throws(() => validateConfig({ ...examples[0], AI_PROMPT_RETENTION: "raw" }), { message: "Invalid or missing AI_PROMPT_RETENTION" });
  assert.doesNotThrow(() => validateConfig({ ...examples[0], AI_PROMPT_RETENTION: "redacted" }));
  const erp = { ...examples[0], DATABASE_URL: examples[0].APP_DATABASE_URL };
  assert.throws(() => validateConfig({ ...erp, AI_PROVIDER: "external" }, "erp"),
    { message: "Invalid or missing AI_PROVIDER" });
  assert.throws(() => validateConfig({ ...erp, AI_PROVIDER: "ollama" }, "erp"),
    { message: "Invalid or missing AI_INTERNAL_TOKEN" });
  assert.doesNotThrow(() => validateConfig({ ...erp, AI_PROVIDER: "ollama", AI_INTERNAL_TOKEN: "a".repeat(32) }, "erp"));
});

test("CLI rejects unfilled example without displaying its placeholder", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./config.mjs", import.meta.url)),
    "--file", fileURLToPath(new URL("./instances/a.env.example", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Invalid or missing POSTGRES_PASSWORD");
  assert.ok(!result.stderr.includes("CHANGE_ME_"));
});

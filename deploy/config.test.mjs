// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateConfig } from "./config.mjs";

const examples = ["a", "b", "c"].map((instance) => {
  const text = readFileSync(new URL(`./instances/${instance}.env.example`, import.meta.url), "utf8")
    .replace(/CHANGE_ME_[A-Z0-9_]+/g, (marker) => marker.replace("CHANGE_ME_", "localonly_"));
  return parseEnv(text);
});

test("all instance contracts parse and isolate ports, buckets and credentials", () => {
  for (const env of examples) validateConfig(env);
  for (const field of ["GATEWAY_HTTP_PORT", "FLOWABLE_HOST_PORT", "S3_BUCKET_PRIVATE", "POSTGRES_PASSWORD", "ORG_CODE"]) {
    assert.equal(new Set(examples.map((env) => env[field])).size, 3, field);
  }
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
    const env = { ...examples[0], DATABASE_URL: examples[0].APP_DATABASE_URL };
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

test("optional AI reference is checked when supplied or when provider enabled", () => {
  assert.throws(() => validateConfig({ ...examples[0], AI_KEY_REF: "invalid" }), { message: "Invalid or missing AI_KEY_REF" });
  assert.throws(() => validateConfig({ ...examples[0], AI_PROVIDER: "local" }), { message: "Invalid or missing AI_KEY_REF" });
});

test("CLI rejects unfilled example without displaying its placeholder", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./config.mjs", import.meta.url)),
    "--file", fileURLToPath(new URL("./instances/a.env.example", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Invalid or missing POSTGRES_PASSWORD");
  assert.ok(!result.stderr.includes("CHANGE_ME_"));
});

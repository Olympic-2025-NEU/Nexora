// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Validate the full deployment contract before Compose interpolation, and the
// subset supplied to each application process before its server starts.
const groups = {
  instance: {
    INSTANCE_ID: "id", ORG_CODE: "id", PUBLIC_BASE_URL: "url", GATEWAY_HTTP_PORT: "port",
    GATEWAY_HTTPS_PORT: "port", POSTGRES_HOST_PORT: "port", KEYCLOAK_HOST_PORT: "port",
  },
  database: {
    POSTGRES_USER: "id", POSTGRES_PASSWORD: "secret", APP_DB_NAME: "id", APP_DB_USER: "id",
    APP_DB_PASSWORD: "secret", CORE_DB_USER: "id", CORE_DB_PASSWORD: "secret",
    MIGRATOR_DB_USER: "id", MIGRATOR_DB_PASSWORD: "secret", KEYCLOAK_DB_USER: "id",
    KEYCLOAK_DB_PASSWORD: "secret", KEYCLOAK_DB_NAME: "id", FLOWABLE_DB_USER: "id",
    FLOWABLE_DB_PASSWORD: "secret", FLOWABLE_DB_NAME: "id", APP_DATABASE_URL: "database",
    CORE_DATABASE_URL: "database", MIGRATOR_DATABASE_URL: "database",
    KEYCLOAK_DATABASE_URL: "database", FLOWABLE_DATABASE_URL: "database",
  },
  oidc: {
    OIDC_BASE_URL: "url", OIDC_ISSUER_URL: "url", OIDC_JWKS_URL: "url",
    OIDC_CLIENT_ID_ERP: "id", OIDC_CLIENT_ID_DXLAB: "id", OIDC_AUDIENCE: "id",
    OIDC_REDIRECT_URI_ERP: "url", OIDC_REDIRECT_URI_DXLAB: "url",
    KC_BOOTSTRAP_ADMIN_USERNAME: "id", KC_BOOTSTRAP_ADMIN_PASSWORD: "secret",
  },
  partner: {
    PARTNER_OUTBOUND_CLIENT_ID: "id", PARTNER_OUTBOUND_SECRET_REF: "ref",
    PARTNER_OUTBOUND_TOKEN_URL: "url", PARTNER_OUTBOUND_AUDIENCE: "id",
    PARTNER_INBOUND_CLIENT_ID: "id",
  },
  s3: {
    S3_ENDPOINT: "url", S3_REGION: "id", S3_BUCKET_QUARANTINE: "bucket",
    S3_BUCKET_PRIVATE: "bucket", S3_BUCKET_PUBLIC: "bucket", S3_SECRET_REF: "ref",
    S3_ACCESS_KEY: "secret", S3_SECRET_KEY: "secret", S3_SCANNER_ACCESS_KEY: "secret",
    S3_SCANNER_SECRET_KEY: "secret", S3_ADMIN_ACCESS_KEY: "secret", S3_ADMIN_SECRET_KEY: "secret",
  },
  flowable: {
    FLOWABLE_BASE_URL: "url", FLOWABLE_AUTH_REF: "ref", FLOWABLE_PROCESS_KEY: "id",
    FLOWABLE_ADMIN_USER: "id", FLOWABLE_ADMIN_PASSWORD: "secret",
  },
  redis: { REDIS_URL: "redis" },
  ai: { AI_BASE_URL: "url", AI_PROVIDER: "id" },
};

const runtime = {
  erp: { DATABASE_URL: "database", OIDC_ISSUER_URL: "url", PUBLIC_BASE_URL: "url" },
  worker: { DATABASE_URL: "database", FLOWABLE_BASE_URL: "url", REDIS_URL: "redis", FLOWABLE_ADMIN_USER: "id", FLOWABLE_ADMIN_PASSWORD: "secret" },
  "core-data": {
    CORE_DATABASE_URL: "database", S3_ENDPOINT: "url", S3_ACCESS_KEY: "secret",
    S3_SECRET_KEY: "secret", S3_BUCKET_PRIVATE: "bucket",
  },
};

function fail(name) {
  throw new Error(`Invalid or missing ${name}`);
}

function url(name, value, schemes) {
  try {
    const parsed = new URL(value);
    if (!schemes.includes(parsed.protocol) || !parsed.hostname || parsed.hash) fail(name);
    return parsed;
  } catch {
    fail(name);
  }
}

function check(name, value, type) {
  if (typeof value !== "string" || !value.trim() || value.includes("CHANGE_ME_")) fail(name);
  switch (type) {
    case "id":
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) fail(name);
      break;
    case "bucket":
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)) fail(name);
      break;
    case "port":
      if (!/^[0-9]+$/.test(value) || +value < 1 || +value > 65535) fail(name);
      return Number(value);
    case "url":
      return url(name, value, ["http:", "https:"]);
    case "database": {
      const parsed = url(name, value, ["postgresql:", "postgres:"]);
      if (!parsed.username || !parsed.password || parsed.pathname.length < 2) fail(name);
      return parsed;
    }
    case "redis":
      return url(name, value, ["redis:", "rediss:"]);
    case "ref":
      if (!/^(env:[A-Z][A-Z0-9_]*|secret:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.test(value)) fail(name);
      break;
    case "secret":
      if (/\s/.test(value)) fail(name);
      break;
  }
  return value;
}

export function validateConfig(env, service) {
  if (service && !runtime[service]) fail("service");
  const fields = service ? runtime[service] : Object.assign({}, ...Object.values(groups));
  const config = {};
  for (const [name, type] of Object.entries(fields)) config[name] = check(name, env[name], type);
  if (service) return config;
  if (!/^[abc]$/.test(env.INSTANCE_ID)) fail("INSTANCE_ID");

  for (const [name, user, password, database] of [
    ["APP_DATABASE_URL", "APP_DB_USER", "APP_DB_PASSWORD", "APP_DB_NAME"],
    ["CORE_DATABASE_URL", "CORE_DB_USER", "CORE_DB_PASSWORD", "APP_DB_NAME"],
    ["MIGRATOR_DATABASE_URL", "MIGRATOR_DB_USER", "MIGRATOR_DB_PASSWORD", "APP_DB_NAME"],
    ["KEYCLOAK_DATABASE_URL", "KEYCLOAK_DB_USER", "KEYCLOAK_DB_PASSWORD", "KEYCLOAK_DB_NAME"],
    ["FLOWABLE_DATABASE_URL", "FLOWABLE_DB_USER", "FLOWABLE_DB_PASSWORD", "FLOWABLE_DB_NAME"],
  ]) {
    const parsed = config[name];
    try {
      if (decodeURIComponent(parsed.username) !== env[user] ||
          decodeURIComponent(parsed.password) !== env[password] ||
          decodeURIComponent(parsed.pathname.slice(1)) !== env[database] ||
          parsed.hostname !== "postgres") fail(name);
    } catch {
      fail(name);
    }
  }
  if (env.APP_DB_USER === env.CORE_DB_USER ||
      env.APP_DB_NAME === env.KEYCLOAK_DB_NAME || env.APP_DB_NAME === env.FLOWABLE_DB_NAME ||
      env.KEYCLOAK_DB_NAME === env.FLOWABLE_DB_NAME) fail("KEYCLOAK_DATABASE_URL");
  if (config.OIDC_ISSUER_URL.href !== `${config.OIDC_BASE_URL.href.replace(/\/$/, "")}/realms/nexora`)
    fail("OIDC_ISSUER_URL");
  if (config.OIDC_JWKS_URL.href !== `${config.OIDC_ISSUER_URL.href}/protocol/openid-connect/certs`)
    fail("OIDC_JWKS_URL");
  for (const name of ["OIDC_REDIRECT_URI_ERP", "OIDC_REDIRECT_URI_DXLAB"]) {
    if (config[name].origin !== config.PUBLIC_BASE_URL.origin) fail(name);
  }
  if (config.PUBLIC_BASE_URL.hostname !== "127.0.0.1" && config.PUBLIC_BASE_URL.protocol !== "https:")
    fail("PUBLIC_BASE_URL");
  if (config.PUBLIC_BASE_URL.port !== String(config.GATEWAY_HTTP_PORT)) fail("GATEWAY_HTTP_PORT");
  if (new Set([config.GATEWAY_HTTP_PORT, config.POSTGRES_HOST_PORT, config.KEYCLOAK_HOST_PORT]).size !== 3)
    fail("GATEWAY_HTTP_PORT");
  if (config.PARTNER_OUTBOUND_TOKEN_URL.origin !== config.OIDC_BASE_URL.origin) fail("PARTNER_OUTBOUND_TOKEN_URL");
  for (const name of ["S3_BUCKET_PRIVATE", "S3_BUCKET_PUBLIC", "S3_BUCKET_QUARANTINE"]) {
    if (!env[name].includes(`-${env.INSTANCE_ID}-`)) fail(name);
  }
  if (new Set([env.S3_BUCKET_PRIVATE, env.S3_BUCKET_PUBLIC, env.S3_BUCKET_QUARANTINE]).size !== 3)
    fail("S3_BUCKET_PRIVATE");
  const credentialNames = Object.entries(fields).filter(([, type]) => type === "secret").map(([name]) => name);
  if (new Set(credentialNames.map((name) => env[name])).size !== credentialNames.length)
    fail("S3_SECRET_KEY");
  for (const name of ["S3_SECRET_REF", "FLOWABLE_AUTH_REF"]) {
    const key = env[name].slice(4);
    if (env[name].startsWith("env:") && (!env[key] || env[key].startsWith("CHANGE_ME_"))) fail(name);
  }
  if (env.AI_KEY_REF || env.AI_PROVIDER !== "none") check("AI_KEY_REF", env.AI_KEY_REF, "ref");
  if (env.KC_DEV_USER_PASSWORD) check("KC_DEV_USER_PASSWORD", env.KC_DEV_USER_PASSWORD, "secret");
  if (env.KC_DEV_USERNAME) check("KC_DEV_USERNAME", env.KC_DEV_USERNAME, "id");
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, argument] = process.argv.slice(2);
    if (mode === "--file" && argument) validateConfig(parseEnv(readFileSync(argument, "utf8")));
    else if (mode === "--runtime" && argument) validateConfig(process.env, argument);
    else fail("config arguments");
    console.log("Config valid");
  } catch (error) {
    // Never print parser, filesystem, URL, or environment error details.
    console.error(error.message?.startsWith("Invalid or missing ") ? error.message : "Invalid or missing config file");
    process.exitCode = 1;
  }
}

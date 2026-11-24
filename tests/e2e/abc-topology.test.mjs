// SPDX-License-Identifier: AGPL-3.0-only
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const services = ["postgres", "keycloak", "flowable", "seaweedfs", "gateway",
  "erp", "worker", "core-data"];
const layouts = "abc".split("").map((instance) => {
  const file = resolve(root, "deploy", "instances", `${instance}.env.example`);
  const env = parseEnv(readFileSync(file, "utf8"));
  const result = spawnSync("docker", ["compose", "-f", "deploy/compose.yml",
    "-f", "deploy/compose.local-admin.yml", "--env-file", file,
    "-p", `nexora-${instance}`, "--profile", "apps", "config", "--format", "json"],
  { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `Compose config failed for ${instance}`);
  return { instance, env, config: JSON.parse(result.stdout) };
});

test("P09-T01 three Compose projects isolate identity, state, routes and ports", () => {
  const volumeNames = [];
  const published = [];
  const routeFiles = [];
  const issuers = [];
  for (const { instance, env, config } of layouts) {
    const project = `nexora-${instance}`;
    assert.equal(config.name, project);
    for (const service of services) {
      assert.ok(config.services[service], `${instance} missing ${service}`);
      assert.equal(config.services[service].container_name, undefined,
        `${instance}/${service} has a global container name`);
    }
    assert.ok(config.services.keycloak.networks.internal.aliases.includes(`keycloak-${instance}`));
    assert.equal(config.services.keycloak.environment.KC_HOSTNAME, env.OIDC_BASE_URL);
    assert.equal(config.services.erp.environment.OIDC_ISSUER_URL, env.OIDC_ISSUER_URL);
    assert.equal(config.services.erp.environment.DATABASE_URL, env.APP_DATABASE_URL);
    assert.equal(config.services["core-data"].environment.CORE_DATABASE_URL, env.CORE_DATABASE_URL);
    const urls = ["APP_DATABASE_URL", "CORE_DATABASE_URL", "MIGRATOR_DATABASE_URL",
      "KEYCLOAK_DATABASE_URL", "FLOWABLE_DATABASE_URL"].map((key) => new URL(env[key]));
    assert.ok(urls.every((url) => url.hostname === "postgres"));
    assert.equal(new Set(urls.map((url) => url.pathname)).size, 3);
    issuers.push(env.OIDC_ISSUER_URL);
    const route = config.services.gateway.volumes.find((item) =>
      item.target === "/usr/local/apisix/conf/apisix.yaml");
    assert.ok(route.source.endsWith(resolve("deploy", "instances", instance, "apisix.generated.yaml")));
    routeFiles.push(route.source);
    for (const volume of Object.values(config.volumes)) {
      assert.ok(volume.name.startsWith(`${project}_`));
      volumeNames.push(volume.name);
    }
    for (const service of Object.values(config.services)) for (const port of service.ports ?? []) {
      assert.equal(port.host_ip, "127.0.0.1");
      published.push(port.published);
    }
  }
  assert.equal(new Set(issuers).size, 3);
  assert.equal(new Set(routeFiles).size, 3);
  assert.equal(new Set(volumeNames).size, volumeNames.length);
  assert.equal(new Set(published).size, published.length);
});

test("P09-T01 reset refuses missing DEMO_ONLY and project outside allowlist", () => {
  const reset = resolve(root, "deploy", "scripts", "abc-reset.mjs");
  for (const [instance, demoOnly] of [["a", undefined], ["production", "true"]]) {
    const env = { ...process.env };
    if (demoOnly) env.DEMO_ONLY = demoOnly;
    else delete env.DEMO_ONLY;
    const result = spawnSync(process.execPath, [reset, instance], {
      cwd: root, env, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Reset refused/);
  }
});

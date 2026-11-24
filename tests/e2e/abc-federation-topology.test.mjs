// SPDX-License-Identifier: AGPL-3.0-only
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
test("federation demo exposes only gateways and workers on the shared transport", () => {
  for (const instance of "abc") {
    const envFile = `deploy/instances/${instance}.env.example`;
    const env = parseEnv(readFileSync(resolve(root, envFile), "utf8"));
    const result = spawnSync("docker", ["compose", "-f", "deploy/compose.yml",
      "-f", "deploy/compose.local-admin.yml", "-f", "deploy/compose.federation-demo.yml",
      "--env-file", envFile, "-p", `nexora-${instance}`, "--profile", "apps",
      "config", "--format", "json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${instance}: invalid Compose overlay: ${result.stderr}`);
    const config = JSON.parse(result.stdout);
    const shared = Object.entries(config.services).filter(([, service]) =>
      service.networks && "federation" in service.networks).map(([name]) => name).sort();
    assert.deepEqual(shared, ["gateway", "worker"]);
    assert.ok(config.services.gateway.networks.federation.aliases.includes(
      `gateway-${instance}.nexora.test`));
    assert.equal(config.services.erp.environment.NEXORA_ISSUER_INSTANCE_ID,
      `nexora-${instance}`);
    assert.equal(config.services.worker.environment.NEXORA_ISSUER_INSTANCE_ID,
      `nexora-${instance}`);
    assert.equal(config.services.keycloak.networks.federation, undefined);
    assert.equal(config.services.postgres.networks.federation, undefined);
    assert.equal(config.services.worker.environment.NODE_EXTRA_CA_CERTS,
      "/usr/local/share/nexora-certs/rootCA.pem");
    assert.equal(config.networks.federation.name, "nexora-federation");
    assert.equal(env.INSTANCE_ID, instance);
  }
});

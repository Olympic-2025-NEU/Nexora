// SPDX-License-Identifier: AGPL-3.0-only
// Destructive only for explicitly named, loopback-only P09 demo projects.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { validateConfig } from "../config.mjs";

const instance = process.argv[2];
if (process.env.DEMO_ONLY !== "true" || !/^[abc]$/.test(instance ?? "")) {
  console.error("Reset refused: DEMO_ONLY=true and explicit a|b|c are required");
  process.exit(1);
}
const root = resolve(import.meta.dirname, "../..");
const file = resolve(root, "deploy", "instances", `${instance}.env`);
const values = parseEnv(readFileSync(file, "utf8"));
validateConfig(values);
if (values.INSTANCE_ID !== instance || values.ORG_CODE !== `ORG-${instance.toUpperCase()}` ||
    values.PUBLIC_BASE_URL !== `http://127.0.0.1:${values.GATEWAY_HTTP_PORT}` ||
    values.APISIX_RENDERED_PATH !== `./instances/${instance}/apisix.generated.yaml`) {
  throw new Error("Reset refused: demo identity mismatch");
}
const project = `nexora-${instance}`;
const args = ["compose", "-f", "deploy/compose.yml",
  "-f", "deploy/compose.local-admin.yml", "--env-file", file,
  "-p", project, "--profile", "apps", "--profile", "core",
  "--profile", "dxlab", "--profile", "ai", "down", "-v", "--remove-orphans"];
const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
for (const listing of [["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`,
    "--format", "{{.ID}}"],
  ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`,
    "--format", "{{.Name}}"]]) {
  const remaining = spawnSync("docker", listing, { encoding: "utf8" });
  if (remaining.status !== 0 || remaining.stdout.trim())
    throw new Error(`Reset incomplete for ${project}`);
}
console.log(`Reset only ${project}`);

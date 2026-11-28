// SPDX-License-Identifier: AGPL-3.0-only
// Demo-only non-destructive B outage/recovery; never prints env or credentials.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { demoProject } from "./demo-project.mjs";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");
const root = resolve(import.meta.dirname, "../..");
const instances = Object.fromEntries("abc".split("").map((name) => {
  const env = parseEnv(readFileSync(resolve(root, "deploy/instances", `${name}.env`), "utf8"));
  assert.equal(env.INSTANCE_ID, name);
  assert.equal(env.ORG_CODE, `ORG-${name.toUpperCase()}`);
  assert.equal(env.PUBLIC_BASE_URL, `http://127.0.0.1:${env.GATEWAY_HTTP_PORT}`);
  return [name, env.PUBLIC_BASE_URL];
}));
const composeArgs = ["compose", "-f", "deploy/compose.yml", "-f", "deploy/compose.local-admin.yml",
  "-f", "deploy/compose.federation-demo.yml", "--env-file", "deploy/instances/b.env",
  "-p", demoProject("b"), "--profile", "apps"];
function compose(action) {
  const result = spawnSync("docker", [...composeArgs, action, "gateway", "erp"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`B Compose ${action} failed`);
}
async function available(name) {
  try {
    const response = await fetch(instances[name], { signal: AbortSignal.timeout(4_000) });
    return response.status === 200;
  } catch { return false; }
}
async function waitFor(name) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await available(name)) return;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error(`${name} did not recover`);
}

assert.ok((await Promise.all(["a", "b", "c"].map(available))).every(Boolean),
  "A/B/C must be healthy before outage drill");
let stopped = false;
try {
  compose("stop"); stopped = true;
  const state = await Promise.all(["a", "b", "c"].map(available));
  assert.deepEqual(state, [true, false, true], "A/C must stay up while B gateway/ERP is down");
  console.log(JSON.stringify({ phase: "b_offline", a: "up", b: "down", c: "up" }));
} finally {
  if (stopped) {
    compose("start");
    await waitFor("b");
  }
}
assert.ok((await Promise.all(["a", "b", "c"].map(available))).every(Boolean));
console.log(JSON.stringify({ phase: "b_recovered", a: "up", b: "up", c: "up" }));

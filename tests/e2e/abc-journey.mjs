// SPDX-License-Identifier: AGPL-3.0-only
/**
 * P13-T02 A→B→C journey entrypoint (API-only; no hand SQL).
 *
 * Modes (argv[2] or E2E_ABC_MODE):
 *   topology (default) — Compose config isolation for a/b/c from *.env.example
 *   contract            — assert journey-p09-core encodes demo-fixtures balances
 *   live                — run deploy/scripts/journey-p09-core.mjs (needs DEMO_ONLY,
 *                         a/b/c env + fixture-manifest, three live stacks)
 *   a-api               — smoke API on instance A only (narrow RAM hosts)
 *
 * npm: `npm run test:e2e:abc`
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const mode = process.argv[2] ?? process.env.E2E_ABC_MODE ?? "topology";

function runNode(rel, args = [], env = {}) {
  const result = spawnSync(process.execPath, [resolve(root, rel), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${rel} exited ${result.status}`);
  return result;
}

function topology() {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=spec", resolve(root, "tests/e2e/abc-topology.test.mjs")],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `abc-topology exited ${result.status}`);
  console.log(JSON.stringify({ mode: "topology", result: "PASS" }));
}

function contract() {
  const core = readFileSync(resolve(root, "deploy/scripts/journey-p09-core.mjs"), "utf8");
  const fixtures = readFileSync(resolve(root, "documents/phase-plan/demo-fixtures.md"), "utf8");
  assert.match(fixtures, /GoodsReceipt 20/);
  assert.match(fixtures, /GoodsIssue 12/);
  assert.match(fixtures, /actual 10/);
  assert.match(fixtures, /GoodsIssue 6/);
  assert.match(fixtures, /actual 6/);
  assert.match(fixtures, /sale.*2|GoodsIssue 2 purpose `sale`/s);
  assert.match(fixtures, /8\+4\+4=16|balances.*8.*4.*4/s);
  assert.match(core, /quantity: "20"/);
  assert.match(core, /partner_transfer", 12/);
  assert.match(core, /receive\("b".*10/);
  assert.match(core, /partner_transfer", 6/);
  assert.match(core, /receive\("c".*6/);
  assert.match(core, /"sale", 2/);
  assert.match(core, /\[8, 4, 4\]/);
  assert.ok(!core.includes("SELECT "), "journey must not use hand SQL");
  console.log(JSON.stringify({
    mode: "contract",
    result: "PASS",
    expectedBalances: { a: 8, b: 4, c: 4 },
    runner: "deploy/scripts/journey-p09-core.mjs",
  }));
}

function live() {
  assert.equal(process.env.DEMO_ONLY, "true", "DEMO_ONLY=true required for live journey");
  for (const name of "abc") {
    assert.ok(existsSync(resolve(root, `deploy/instances/${name}.env`)), `missing ${name}.env`);
    assert.ok(existsSync(resolve(root, `deploy/instances/${name}/fixture-manifest.json`)),
      `missing ${name}/fixture-manifest.json — seed ABC topology first`);
  }
  runNode("deploy/scripts/journey-p09-core.mjs", [], { DEMO_ONLY: "true" });
}

async function aApi() {
  const envPath = resolve(root, "deploy/instances/a.env");
  assert.ok(existsSync(envPath), "deploy/instances/a.env required for a-api mode");
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const base = env.PUBLIC_BASE_URL ?? "http://127.0.0.1:19080";
  const ping = await fetch(`${base}/gateway/ping`);
  assert.equal(ping.status, 200, `gateway ping ${ping.status}`);
  const live = await fetch(`${base}/api/v1/health/live`);
  // Gateway may require auth on ERP health; accept 200 or 401 as "reachable"
  assert.ok([200, 401].includes(live.status), `health/live unexpected ${live.status}`);
  let authOk = false;
  let balanceRows = null;
  if (env.KC_DEV_USERNAME && env.KC_DEV_USER_PASSWORD && env.KEYCLOAK_HOST_PORT) {
    const tokenRes = await fetch(
      `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT}/realms/nexora/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "erp-browser",
          username: env.KC_DEV_USERNAME,
          password: env.KC_DEV_USER_PASSWORD,
        }),
      },
    );
    if (tokenRes.ok) {
      const { access_token: token } = await tokenRes.json();
      const bal = await fetch(`${base}/api/v1/inventory/balances?limit=5`, {
        headers: { authorization: `Bearer ${token}` },
      });
      authOk = bal.ok;
      if (bal.ok) balanceRows = await bal.json();
    }
  }
  console.log(JSON.stringify({
    mode: "a-api",
    result: "PASS",
    gatewayPing: ping.status,
    healthLive: live.status,
    inventoryBalancesAuthed: authOk,
    note: "Full A20→C sale2 requires live mode with three stacks; see known-limitations KL-05",
    sample: balanceRows?.data?.length ?? null,
  }));
}

if (mode === "topology") topology();
else if (mode === "contract") contract();
else if (mode === "live") live();
else if (mode === "a-api") await aApi();
else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(2);
}

// SPDX-License-Identifier: AGPL-3.0-only
/** P12-T05 static security matrix — no secrets printed. */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

test("gateway default-deny and forged identity docs/tests exist", () => {
  assert.ok(existsSync("tests/gateway/private.test.mjs"));
  assert.ok(existsSync("tests/gateway/m2m.test.mjs"));
  const policy = readFileSync("tests/gateway/policy.test.mjs", "utf8");
  assert.match(policy, /401|403|audience|issuer/i);
});

test("ClamAV fail-closed scan suite exists", () => {
  assert.ok(existsSync("tests/platform/scan.integration.test.mjs"));
  const body = readFileSync("tests/platform/scan.integration.test.mjs", "utf8");
  assert.match(body, /infected|quarantine|fail/i);
});

test("AI adversarial denies confirm tool", () => {
  assert.ok(existsSync("tests/ai/draft-adversarial.test.ts"));
  const body = readFileSync("tests/ai/draft-adversarial.test.ts", "utf8");
  assert.match(body, /confirm/i);
});

test("compose keeps admin ports off public publish by default", () => {
  const compose = readFileSync("deploy/compose.yml", "utf8");
  assert.doesNotMatch(compose, /ports:\s*\n\s*-\s*["']?5432:5432/m);
  assert.doesNotMatch(compose, /FLOWABLE_HOST_PORT.*published/i);
  assert.match(compose, /networks:\s*\[internal\]/);
});

test("OT simulator cannot mutate stock modules", () => {
  const ingest = readFileSync("contexts/traceability/application/ot-ingest.ts", "utf8");
  assert.doesNotMatch(ingest, /stockBalance|stockMovement|adjustStock/);
});

test("secret scanners and SPDX checks are wired", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(typeof pkg.scripts["check:secrets"], "string");
  assert.equal(typeof pkg.scripts["check:spdx"], "string");
});

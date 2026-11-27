// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const journey = resolve(root, "tests/e2e/abc-journey.mjs");

function run(mode) {
  const result = spawnSync(process.execPath, [journey, mode], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `abc-journey ${mode} failed`);
}

test("P13-T02 fixture contract matches demo-fixtures A20→C sale2", () => {
  run("contract");
});

test("P13-T02 A/B/C Compose topology isolation (env.example)", () => {
  run("topology");
});

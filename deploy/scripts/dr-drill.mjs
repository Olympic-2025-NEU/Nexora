#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Timed DR consistency drill (P12-T08).
 * Runs post-restore asserts against live instance A and records wall times.
 * Full backup/restore remains via backup.sh + restore.sh (see backup-restore.md).
 *
 * Usage: node deploy/scripts/dr-drill.mjs [composeProject]
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const project = process.argv[2] ?? "nexora";
const t0 = Date.now();
const assert = spawnSync(process.execPath, [
  resolve("deploy/scripts/post-restore-assert.mjs"),
  project,
  "deploy/instances/a.env",
], { encoding: "utf8" });
const t1 = Date.now();

const report = {
  project,
  assertExit: assert.status,
  assertStdout: assert.stdout,
  assertStderr: assert.stderr,
  /** Time to complete post-restore style asserts (proxy RTO segment on this host). */
  assertDurationMs: t1 - t0,
  /**
   * RPO for Compose demo: age of last verified backup package.
   * Without an offsite package path, RPO is "since last successful backup.sh + verify-backup.mjs".
   */
  rpoNote: "RPO = age of last verified backup package at incident time; not continuous replication.",
  rtoNote: "RTO measured here is assertDurationMs on live A; full restore.sh wall-clock is additional and host-dependent.",
  topology: {
    A: "primary demo compose project (this drill)",
    B: "optional second project — same scripts, separate volumes/ports",
    C: "optional third — same; no shared PG volume with A",
  },
  measuredAt: new Date().toISOString(),
};

console.log(report.assertStdout);
if (report.assertStderr) console.error(report.assertStderr);
console.log(JSON.stringify({
  assertExit: report.assertExit,
  assertDurationMs: report.assertDurationMs,
  rpoNote: report.rpoNote,
  rtoNote: report.rtoNote,
  topology: report.topology,
  measuredAt: report.measuredAt,
}, null, 2));
process.exit(assert.status ?? 1);

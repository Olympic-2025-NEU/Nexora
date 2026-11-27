#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * P13-T06 — prepare a reproducible source .tar.gz + sha256 via `git archive`.
 * Does NOT create git tags or GitHub releases (owner confirms tag name separately).
 *
 * Usage (repo root = package root):
 *   node scripts/prep-release-archive.mjs [output-dir]
 *
 * Env:
 *   RELEASE_PREFIX — archive basename prefix (default: nexora-phase-13)
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nexoraRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? resolve(nexoraRoot, "dist/release"));
const prefix = process.env.RELEASE_PREFIX ?? "nexora-phase-13";

function git(args) {
  const r = spawnSync("git", args, { cwd: nexoraRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const commit = git(["rev-parse", "HEAD"]);
const short = commit.slice(0, 12);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const base = `${prefix}-${short}`;
mkdirSync(outDir, { recursive: true });

const tarPath = resolve(outDir, `${base}.tar.gz`);
const archived = spawnSync(
  "git",
  ["archive", "--format=tar.gz", `-o`, tarPath, "HEAD"],
  { cwd: nexoraRoot, encoding: "utf8" },
);
if (archived.status !== 0) {
  throw new Error(`git archive failed: ${archived.stderr || archived.stdout}`);
}

const sha256 = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
const sumPath = resolve(outDir, `${base}.tar.gz.sha256`);
writeFileSync(sumPath, `${sha256}  ${base}.tar.gz\n`, "utf8");

const meta = {
  createdAt: new Date().toISOString(),
  stamp,
  branch,
  commit,
  short,
  archive: tarPath,
  sha256,
  bytes: statSync(tarPath).size,
  prismaTip: "20261127160000_quality_operations",
  bpmn: "goods-issue-approval",
  openapi: "contracts/openapi/nexora-v1.yaml",
  sbomPointers: [
    "documents/phase-plan/evidence/npm-license-inventory.json",
    "npm run check:licenses",
    "npm run check:spdx",
  ],
  imageDigestsDemo: {
    note: "Local demo tags from G12 — rebuild after owner-confirmed release tag",
    erp: "sha256:fc2cf681b959dd84f1fd949d96cb2f6c16b2fad3bc07dd4ba3814ba067df7411",
    dxLab: "sha256:350d6c158229394ae07cef0f6e29fccc383e86752a0a8766a31bd1967b902376",
    coreData: "sha256:110d9498a299d80e88e9cfa0363671f87d788b91954a992f80c50ad80bd2b2ae",
    migrator: "sha256:37a9ccf30a02622cad97a5796f8a7b482d04e69c856f406acddf54b4b50a44b5",
  },
  tagStatus:
    "NOT_CREATED — confirm name with owner (suggested: v0.13.0-contest or contest-2026-p13)",
};
writeFileSync(resolve(outDir, `${base}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify({ result: "PASS", ...meta }, null, 2));

// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const LOCKFILE = "package-lock.json";
const INVENTORY = "documents/phase-plan/evidence/npm-license-inventory.json";
const knownExpressions = new Set([
  "0BSD", "Apache-2.0", "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT", "BSD-2-Clause",
  "BSD-3-Clause", "BlueOak-1.0.0", "CC-BY-4.0", "CC0-1.0",
  "ISC", "LGPL-3.0-or-later", "MIT", "MPL-2.0", "Python-2.0",
]);

const lockBytes = readFileSync(LOCKFILE);
// Git may check out CRLF on Windows and LF on Linux. Inventory the normalized
// repository content so the same committed lockfile has one cross-OS digest.
const normalizedLockBytes = Buffer.from(lockBytes.toString("utf8").replaceAll("\r\n", "\n"));
const lock = JSON.parse(lockBytes);
if (lock.lockfileVersion !== 3 || !lock.packages) {
  throw new Error("Expected npm lockfile v3 with package entries");
}

const packages = Object.entries(lock.packages)
  .filter(([path]) => path !== "")
  .map(([path, entry]) => ({
    path,
    version: entry.version,
    license: entry.license,
    resolved: entry.resolved,
    integrity: entry.integrity,
    dev: Boolean(entry.dev),
    optional: Boolean(entry.optional),
  }))
  .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const incomplete = packages.filter((entry) =>
  !entry.version || !entry.license || !entry.integrity ||
  !entry.resolved?.startsWith("https://registry.npmjs.org/"),
);
const unknown = packages.filter((entry) => !knownExpressions.has(entry.license));
if (incomplete.length || unknown.length) {
  for (const entry of incomplete) console.error(`Missing provenance: ${entry.path}`);
  for (const entry of unknown) console.error(`Review new license expression: ${entry.path} (${entry.license})`);
  process.exit(1);
}

const inventory = {
  source: LOCKFILE,
  lockSha256: createHash("sha256").update(normalizedLockBytes).digest("hex"),
  packageCount: packages.length,
  packages,
};
if (process.argv.includes("--write-inventory")) {
  writeFileSync(INVENTORY, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Wrote ${INVENTORY} (${packages.length} packages)`);
} else {
  const actual = JSON.parse(readFileSync(INVENTORY, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(inventory)) {
    console.error(`License inventory is stale. Run node scripts/check-licenses.mjs --write-inventory`);
    process.exit(1);
  }
  console.log(`check-licenses: OK (${packages.length} lockfile packages with license and source)`);
}

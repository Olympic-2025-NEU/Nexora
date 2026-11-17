#!/usr/bin/env node
/**
 * Fail if authored .ts/.tsx under allowlist paths lack SPDX-License-Identifier.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ROOTS = ["app", "platform", "contexts", "composition", "components", "scripts"];
const SKIP_NAMES = new Set(["next-env.d.ts"]);
const MARKER = "SPDX-License-Identifier:";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP_NAMES.has(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => {
  const abs = join(ROOT, r);
  try {
    return walk(abs);
  } catch {
    return [];
  }
});

const missing = [];
for (const file of files) {
  const head = readFileSync(file, "utf8").slice(0, 800);
  if (!head.includes(MARKER)) missing.push(relative(ROOT, file).replaceAll("\\", "/"));
}

if (missing.length) {
  console.error(`SPDX missing in ${missing.length} file(s):`);
  for (const f of missing) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`check-spdx: OK (${files.length} files)`);

// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".py", ".css", ".prisma"]);
const INVENTORY = "documents/phase-plan/evidence/source-inventory.json";
const HEADER = /^\s*(?:\/\/|\/\*|\*|#)\s*SPDX-License-Identifier:\s*AGPL-3\.0-only\s*(?:\*\/)?\s*$/m;

function sourcePaths() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((path) => {
      if (!existsSync(path)) return false;
      if (path === "next-env.d.ts" || path.startsWith("prisma/migrations/")) return false;
      return [...SOURCE_EXTENSIONS].some((extension) => path.endsWith(extension));
    })
    .sort();
}

const paths = sourcePaths();
const missing = paths.filter((path) => {
  const firstLines = readFileSync(resolve(path), "utf8").split(/\r?\n/, 6).join("\n");
  return !HEADER.test(firstLines);
});
if (missing.length) {
  console.error("Missing exact AGPL-3.0-only SPDX header:");
  for (const path of missing) console.error(`  ${path}`);
  process.exit(1);
}

const expected = {
  license: "AGPL-3.0-only",
  excludedGenerated: ["next-env.d.ts", "prisma/migrations/**"],
  files: paths,
};
if (process.argv.includes("--write-inventory")) {
  writeFileSync(INVENTORY, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`Wrote ${INVENTORY} (${paths.length} sources)`);
} else {
  const actual = JSON.parse(readFileSync(INVENTORY, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`Source inventory is stale. Run node scripts/check-spdx.mjs --write-inventory`);
    process.exit(1);
  }
  console.log(`check-spdx: OK (${paths.length} sources, exact license, inventory in sync)`);
}

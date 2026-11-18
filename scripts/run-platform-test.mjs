// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const scripts = {
  schema: "tests/platform/run-schema.sh",
  transaction: "tests/platform/run-unit-of-work.sh",
  audit: "tests/platform/run-audit.sh",
};
const script = scripts[process.argv[2]];
if (!script) {
  console.error("Expected platform test: schema, transaction or audit");
  process.exit(2);
}

const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
const gitBash = join(programFiles, "Git", "bin", "bash.exe");
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const result = spawnSync(bash, [script], { stdio: "inherit" });
if (result.error) console.error(`Cannot start Bash: ${result.error.message}`);
process.exit(result.status ?? 1);

// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const scripts = {
  schema: "tests/platform/run-schema.sh",
  transaction: "tests/platform/run-unit-of-work.sh",
  audit: "tests/platform/run-audit.sh",
  records: "tests/platform/run-records.sh",
  evidence: "tests/platform/run-evidence.sh",
  files: "tests/platform/run-files.sh",
  scan: "tests/platform/run-scan.sh",
  idempotency: "tests/platform/run-idempotency.sh",
  outbox: "tests/platform/run-outbox.sh",
  events: "tests/platform/run-events.sh",
};
const script = scripts[process.argv[2]];
if (!script) {
  console.error("Expected platform test: schema, transaction, audit, records, evidence, files, scan, idempotency, outbox or events");
  process.exit(2);
}

const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
const gitBash = join(programFiles, "Git", "bin", "bash.exe");
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const result = spawnSync(bash, [script], { stdio: "inherit" });
if (result.error) console.error(`Cannot start Bash: ${result.error.message}`);
process.exit(result.status ?? 1);

// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";

const candidates = process.platform === "win32"
  ? [["py", "-3"], ["python", ""]]
  : [["python3", ""], ["python", ""]];

for (const [command, versionFlag] of candidates) {
  const prefix = versionFlag ? [versionFlag] : [];
  const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0 || !/^Python 3\./.test(`${probe.stdout}${probe.stderr}`)) continue;
  const result = spawnSync(command, [...prefix, "scripts/check-jcs-python.py"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.error("Python 3 is required for the JCS contract check");
process.exit(1);

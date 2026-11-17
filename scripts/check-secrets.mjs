// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);

const forbiddenNames = /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx))$/i;
const patterns = [
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
];
const findings = [];

for (const path of paths) {
  if (!existsSync(path)) continue;
  const normalized = path.replaceAll("\\", "/");
  if (forbiddenNames.test(normalized) && !normalized.endsWith(".env.example")) {
    findings.push(`${normalized}: forbidden credential file name`);
    continue;
  }
  const data = readFileSync(path);
  if (data.includes(0)) continue;
  const lines = data.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [name, pattern] of patterns) {
      if (pattern.test(line)) findings.push(`${normalized}:${index + 1}: ${name}`);
    }
  }
}

if (findings.length) {
  console.error("Potential committed secrets (values withheld):");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`check-secrets: OK (${paths.length} files scanned; known token/private-key patterns)`);

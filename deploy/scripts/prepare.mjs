// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { validateConfig } from "../config.mjs";

const instance = process.argv[2];
if (!/^[abc]$/.test(instance ?? "")) {
  console.error("Choose instance a, b, or c");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "instances", `${instance}.env.example`);
const target = resolve(root, "instances", `${instance}.env`);
try {
  const credentials = new Map();
  const text = readFileSync(source, "utf8").replace(/CHANGE_ME_[A-Z0-9_]+/g, (marker) => {
    if (!credentials.has(marker)) credentials.set(marker, randomBytes(24).toString("hex"));
    return credentials.get(marker);
  });
  validateConfig(parseEnv(text));
  // Exclusive creation: never overwrite local credentials on repeat runs.
  writeFileSync(target, text, { flag: "wx", mode: 0o600 });
  console.log(`Created deploy/instances/${instance}.env`);
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(`Using existing deploy/instances/${instance}.env`);
  } else {
    console.error("Could not prepare instance env");
    process.exitCode = 1;
  }
}

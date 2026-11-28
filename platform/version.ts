// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedVersion: string | null = null;

/**
 * Product semver from root package.json (single source of truth).
 * Falls back to NEXT_PUBLIC_APP_VERSION / 0.1.0 when the file is unavailable.
 */
export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;
  const fromEnv = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (fromEnv) {
    cachedVersion = fromEnv;
    return cachedVersion;
  }
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    cachedVersion = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.1.0";
  } catch {
    cachedVersion = "0.1.0";
  }
  return cachedVersion;
}

/** Optional short commit from CI / image build args. */
export function getAppCommit(): string | null {
  const sha =
    process.env.NEXT_PUBLIC_APP_COMMIT?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.NEXORA_GIT_COMMIT?.trim() ||
    "";
  return sha ? sha.slice(0, 12) : null;
}

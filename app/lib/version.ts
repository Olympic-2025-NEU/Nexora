// SPDX-License-Identifier: AGPL-3.0-only

/** Client-safe product semver injected at build via next.config env. */
export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "0.1.0";

/** Optional short commit SHA when provided at build time. */
export const APP_COMMIT = (() => {
  const raw = process.env.NEXT_PUBLIC_APP_COMMIT?.trim();
  return raw ? raw.slice(0, 12) : null;
})();

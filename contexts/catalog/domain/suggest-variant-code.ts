// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeVariantCode, stripDiacritics } from "./normalize-uom";

/** Remove `(...)`, `"..."`, and `'...'` segments (non-greedy, repeated). */
export function stripBracketedAndQuoted(raw: string): string {
  let s = raw;
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s
      .replace(/\([^)]*\)/g, " ")
      .replace(/"[^"]*"/g, " ")
      .replace(/'[^']*'/g, " ");
  }
  return s;
}

/**
 * Build the SKU/barcode base from a product name:
 * - drop parentheses / quotes and their contents
 * - letter words → first letter, diacritics stripped, uppercased
 * - tokens starting with a digit → whole token (case preserved)
 */
export function buildVariantCodeBase(name: string): string {
  const cleaned = stripBracketedAndQuoted(name).trim().replace(/\s+/g, " ");
  if (!cleaned) return "SP";

  const parts: string[] = [];
  for (const token of cleaned.split(" ")) {
    if (!token) continue;
    if (/^\d/.test(token)) {
      parts.push(token);
      continue;
    }
    const first = stripDiacritics(token[0]!).toUpperCase();
    if (/[A-Z0-9]/.test(first)) parts.push(first);
  }
  return parts.join("") || "SP";
}

/** Match `BASE` + numeric suffix (at least one digit) against a normalized (upper) code. */
export function parseVariantCodeSequence(
  normalizedCode: string,
  normalizedBase: string,
): number | null {
  if (!normalizedCode.startsWith(normalizedBase)) return null;
  const suffix = normalizedCode.slice(normalizedBase.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

/**
 * Allocate next code for `base` given existing normalized registry codes
 * (and optional reserved codes not yet persisted).
 * Suffix is zero-padded to at least 3 digits (`001`, `002`, …; then `1000`+).
 */
export function allocateVariantCode(
  base: string,
  existingNormalizedCodes: readonly string[],
): string {
  const normalizedBase = normalizeVariantCode(base);
  let maxSeq = 0;
  for (const code of existingNormalizedCodes) {
    const seq = parseVariantCodeSequence(code, normalizedBase);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const next = maxSeq + 1;
  const width = Math.max(3, String(next).length);
  return `${base}${String(next).padStart(width, "0")}`;
}

/** Suggest a display code from product name + occupied codes. */
export function suggestVariantCode(
  name: string,
  existingNormalizedCodes: readonly string[],
): string {
  const base = buildVariantCodeBase(name);
  return allocateVariantCode(base, existingNormalizedCodes);
}

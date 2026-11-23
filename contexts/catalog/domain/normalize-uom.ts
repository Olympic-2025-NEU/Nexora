// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";

/** Unicode NFC, trim, collapse whitespace. */
export function normalizeWhitespace(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Strip Vietnamese diacritics for matching keys. */
export function stripDiacritics(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/**
 * Display name: Vietnamese-aware upper-case with diacritics preserved.
 * `cái` / `Cái` / `CÁI` → `CÁI`
 */
export function canonicalUomDisplayName(raw: string): string {
  const trimmed = normalizeWhitespace(raw);
  if (!trimmed) throw new DomainError("UOM_NAME_INVALID", 422);
  return trimmed.toLocaleUpperCase("vi-VN");
}

/** Machine key / code: accent-stripped ASCII upper. */
export function uomNameKey(raw: string): string {
  const display = canonicalUomDisplayName(raw);
  const key = stripDiacritics(display).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!key || key.length > 32) throw new DomainError("UOM_NAME_INVALID", 422);
  return key;
}

export function normalizeSearchKey(raw: string): string {
  return stripDiacritics(normalizeWhitespace(raw)).toLowerCase();
}

/** Variant sku/barcode registry code (upper, trimmed). */
export function normalizeVariantCode(raw: string): string {
  const v = normalizeWhitespace(raw);
  if (!v) throw new DomainError("VARIANT_CODE_INVALID", 422);
  return v.toUpperCase();
}

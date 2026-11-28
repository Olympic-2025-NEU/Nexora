// SPDX-License-Identifier: AGPL-3.0-only

/** Normalize a partner host/URL into an origin (https preferred). */
export function normalizePartnerOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Default notice receive URL for a Nexora partner origin. */
export function defaultNotifyUrl(originOrHost: string): string | null {
  const origin = normalizePartnerOrigin(originOrHost);
  if (!origin) return null;
  return `${origin}/api/v1/federation/events`;
}

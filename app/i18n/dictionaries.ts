// SPDX-License-Identifier: AGPL-3.0-only
import en from "./en.json";
import vi from "./vi.json";

export type Locale = "vi" | "en";

export const LOCALES: Locale[] = ["vi", "en"];
export const DEFAULT_LOCALE: Locale = "vi";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, vi };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

export function resolveLocale(raw: string | null | undefined): Locale {
  if (raw === "en" || raw === "vi") return raw;
  return DEFAULT_LOCALE;
}

/** Dot-path lookup, e.g. "nav.login". */
export function translate(dict: Dictionary, key: string): string {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}

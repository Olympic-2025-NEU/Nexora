// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  getDictionary,
  resolveLocale,
  translate,
  type Dictionary,
  type Locale,
} from "./dictionaries";

const STORAGE_KEY = "nexora.locale";

type LocaleContextValue = {
  locale: Locale;
  dict: Dictionary;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const listeners = new Set<() => void>();
let cachedLocale: Locale | null = null;

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const fromQuery = new URLSearchParams(window.location.search).get("lang");
  if (fromQuery) return resolveLocale(fromQuery);
  try {
    return resolveLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function getLocaleSnapshot(): Locale {
  if (cachedLocale === null) cachedLocale = readStoredLocale();
  return cachedLocale;
}

function getServerLocaleSnapshot(): Locale {
  return DEFAULT_LOCALE;
}

function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitLocale(): void {
  for (const listener of listeners) listener();
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeLocale,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  const setLocale = useCallback((next: Locale) => {
    cachedLocale = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
    emitLocale();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const dict = useMemo(() => getDictionary(locale), [locale]);
  const t = useCallback((key: string) => translate(dict, key), [dict]);

  const value = useMemo(
    () => ({ locale, dict, setLocale, t }),
    [locale, dict, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}

export function useT(): (key: string) => string {
  return useLocale().t;
}

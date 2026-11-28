// SPDX-License-Identifier: AGPL-3.0-only
"use client";

/**
 * Browser session helpers for D04 Bearer API (local password + refresh under
 * ALLOW_DEV_PASSWORD_LOGIN). Re-exports admin token helpers for a clearer name.
 */
export {
  adminApi,
  getAdminAccessToken as getAccessToken,
  getAdminRefreshToken as getRefreshToken,
  setAdminAccessToken,
  setAdminSession as setSession,
} from "./admin-api";

import {
  adminApi,
  clearAdminSession,
  getAdminAccessToken,
} from "./admin-api";

export type MeResponse = {
  userId: string;
  organizationId: string;
  roles: string[];
  unitIds: string[];
  displayName: string;
};

const ME_TTL_MS = 5 * 60_000;
let meCache: { me: MeResponse; at: number } | null = null;

export function getCachedMe(): MeResponse | null {
  if (!getAdminAccessToken()) {
    meCache = null;
    return null;
  }
  if (!meCache) return null;
  if (Date.now() - meCache.at > ME_TTL_MS) {
    meCache = null;
    return null;
  }
  return meCache.me;
}

export function clearMeCache(): void {
  meCache = null;
}

export function clearSession(): void {
  clearMeCache();
  clearAdminSession();
}

export function hasSession(): boolean {
  return Boolean(getAdminAccessToken());
}

export function logoutAndRedirect(to = "/"): void {
  clearSession();
  if (typeof window !== "undefined") {
    window.location.replace(to);
  }
}

export async function fetchMe(options?: { force?: boolean }): Promise<MeResponse | null> {
  if (!getAdminAccessToken()) {
    clearMeCache();
    return null;
  }
  if (!options?.force) {
    const cached = getCachedMe();
    if (cached) return cached;
  }
  const res = await adminApi("/api/v1/me");
  if (!res.ok) {
    clearMeCache();
    return null;
  }
  const me = (await res.json()) as MeResponse;
  meCache = { me, at: Date.now() };
  return me;
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
  totp?: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: "MFA_REQUIRED"; message: string }
  | { ok: false; code?: string; message: string }
> {
  const res = await fetch("/auth/dev-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: input.username.trim(),
      password: input.password,
      ...(input.totp ? { totp: input.totp } : {}),
    }),
  });
  const json = (await res.json()) as {
    error?: string;
    message?: string;
    detail?: string;
    data?: { accessToken?: string; refreshToken?: string | null };
  };
  if (!res.ok || !json.data?.accessToken) {
    const message = json.message ?? json.detail ?? json.error ?? `HTTP ${res.status}`;
    if (json.error === "MFA_REQUIRED") {
      return { ok: false, code: "MFA_REQUIRED", message };
    }
    return {
      ok: false,
      code: json.error,
      message,
    };
  }
  const { setAdminSession } = await import("./admin-api");
  clearMeCache();
  setAdminSession({
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
  });
  return { ok: true };
}

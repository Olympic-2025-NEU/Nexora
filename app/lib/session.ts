// SPDX-License-Identifier: AGPL-3.0-only
"use client";

/**
 * Browser session helpers for D04 Bearer API (local password + refresh under
 * ALLOW_DEV_PASSWORD_LOGIN). Re-exports admin token helpers for a clearer name.
 */
export {
  adminApi,
  clearAdminSession as clearSession,
  getAdminAccessToken as getAccessToken,
  getAdminRefreshToken as getRefreshToken,
  setAdminAccessToken,
  setAdminSession as setSession,
} from "./admin-api";

import { adminApi, clearAdminSession, getAdminAccessToken } from "./admin-api";

export type MeResponse = {
  userId: string;
  organizationId: string;
  roles: string[];
  unitIds: string[];
  displayName: string;
};

export function hasSession(): boolean {
  return Boolean(getAdminAccessToken());
}

export function logoutAndRedirect(to = "/"): void {
  clearAdminSession();
  if (typeof window !== "undefined") {
    window.location.replace(to);
  }
}

export async function fetchMe(): Promise<MeResponse | null> {
  if (!getAdminAccessToken()) return null;
  const res = await adminApi("/api/v1/me");
  if (!res.ok) return null;
  return (await res.json()) as MeResponse;
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
  totp?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
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
    data?: { accessToken?: string; refreshToken?: string | null };
  };
  if (!res.ok || !json.data?.accessToken) {
    return {
      ok: false,
      message: json.message ?? json.error ?? `HTTP ${res.status}`,
    };
  }
  const { setAdminSession } = await import("./admin-api");
  setAdminSession({
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
  });
  return { ok: true };
}

// SPDX-License-Identifier: AGPL-3.0-only
"use client";

const ACCESS_KEY = "nexora.access_token";
const REFRESH_KEY = "nexora.refresh_token";

export function getAdminAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ACCESS_KEY);
}

export function getAdminRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(REFRESH_KEY);
}

export function setAdminSession(tokens: {
  accessToken: string;
  refreshToken?: string | null;
}): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function setAdminAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (!token) {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    return;
  }
  sessionStorage.setItem(ACCESS_KEY, token);
}

export function clearAdminSession(): void {
  setAdminAccessToken(null);
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAdminSession(): Promise<boolean> {
  const refreshToken = getAdminRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch("/auth/dev-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grantType: "refresh_token",
            refreshToken,
          }),
        });
        const json = (await res.json()) as {
          data?: { accessToken?: string; refreshToken?: string | null };
        };
        if (!res.ok || !json.data?.accessToken) {
          clearAdminSession();
          return false;
        }
        setAdminSession({
          accessToken: json.data.accessToken,
          refreshToken: json.data.refreshToken ?? refreshToken,
        });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  if (here.includes("/login") || here.includes("/admin/login")) return;
  clearAdminSession();
  window.location.replace(`/login?next=${encodeURIComponent(here)}`);
}

/** Browser fetch to gateway `/api/v1/*` with Bearer token (D04). */
export async function adminApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let res = await fetch(path, { ...init, headers });
  if (res.status !== 401) return res;

  const refreshed = await refreshAdminSession();
  if (!refreshed) {
    redirectToLogin();
    return res;
  }

  const retryHeaders = new Headers(init.headers);
  const nextToken = getAdminAccessToken();
  if (nextToken) retryHeaders.set("Authorization", `Bearer ${nextToken}`);
  if (init.body && !(init.body instanceof FormData) && !retryHeaders.has("content-type")) {
    retryHeaders.set("content-type", "application/json");
  }
  res = await fetch(path, { ...init, headers: retryHeaders });
  if (res.status === 401) redirectToLogin();
  return res;
}

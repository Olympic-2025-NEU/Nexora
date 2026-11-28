// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { ApiError, getMe } from "../api-client/client";
import type { Me } from "../api-client/openapi-types";
import { safeNext, signInPath } from "./paths";
import { ACCESS_COOKIE, readAccess, readRefresh, REFRESH_COOKIE } from "./session";

export const currentActor = cache(async (): Promise<Me> => {
  const next = safeNext((await headers()).get("x-dxlab-path"));
  const jar = await cookies();
  const access = await readAccess(jar.get(ACCESS_COOKIE)?.value);
  if (!access || access.expiresAt - Date.now() < 60_000) {
    const refresh = await readRefresh(jar.get(REFRESH_COOKIE)?.value);
    if (refresh?.expiresAt && refresh.expiresAt > Date.now()) {
      redirect(`/session/refresh?${new URLSearchParams({ next })}`);
    }
    redirect(signInPath(next, access ? "expired" : "required").slice("/dxlab".length));
  }
  try {
    return await getMe(access.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/session/refresh?${new URLSearchParams({ next })}`);
    }
    if (error instanceof ApiError && error.status === 403) forbidden();
    throw error;
  }
});

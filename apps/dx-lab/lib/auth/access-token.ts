// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, readAccess } from "./session";

/** Read the current DX-Lab access token for server actions / data loaders. */
export async function requireAccessToken(): Promise<string> {
  const jar = await cookies();
  const access = await readAccess(jar.get(ACCESS_COOKIE)?.value);
  if (!access?.token || access.expiresAt <= Date.now()) {
    throw new Error("SESSION_EXPIRED");
  }
  return access.token;
}

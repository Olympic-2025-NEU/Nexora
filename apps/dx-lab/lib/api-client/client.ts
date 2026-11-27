// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { authConfig } from "../auth/config";
import type { Me } from "./openapi-types";

export class ApiError extends Error {
  constructor(readonly status: number) { super(`Gateway HTTP ${status}`); }
}

export async function gatewayGet(path: `/api/v1/${string}`, accessToken: string): Promise<Response> {
  if (!/^\/api\/v1\/[a-zA-Z0-9/_?=&%.-]+$/.test(path) || path.includes("..")) {
    throw new Error("Invalid gateway API path");
  }
  const url = new URL(path, authConfig().gatewayUrl);
  return fetch(url, { method: "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000) });
}

export async function getMe(accessToken: string): Promise<Me> {
  const response = await gatewayGet("/api/v1/me", accessToken);
  if (!response.ok) throw new ApiError(response.status);
  const body: unknown = await response.json();
  if (!isMe(body)) throw new Error("Gateway /me response violates OpenAPI contract");
  return body;
}

function isMe(value: unknown): value is Me {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const roles = ["administrator", "staff", "approver", "viewer"];
  return typeof data.userId === "string" && typeof data.organizationId === "string" &&
    typeof data.displayName === "string" && Array.isArray(data.roles) &&
    data.roles.every((role) => roles.includes(String(role))) &&
    Array.isArray(data.unitIds) && data.unitIds.every((id) => typeof id === "string");
}

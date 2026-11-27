// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { authConfig } from "../auth/config";
import type {
  ApprovalTask,
  FileMetadata,
  Me,
  Member,
  MemberCreate,
  MemberPatch,
  Organization,
  OrganizationPatch,
  Partner,
  PartnerConnectionInput,
  PartnerConnectionView,
  PartnerCreate,
  PartnerPatch,
} from "./openapi-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `Gateway HTTP ${status}: ${code}` : `Gateway HTTP ${status}`);
  }
}

type GatewayMethod = "GET" | "POST" | "PATCH" | "PUT";

function assertGatewayPath(path: string): asserts path is `/api/v1/${string}` {
  if (!/^\/api\/v1\/[a-zA-Z0-9/_?=&%.-]+$/.test(path) || path.includes("..")) {
    throw new Error("Invalid gateway API path");
  }
}

export async function gatewayFetch(
  path: `/api/v1/${string}`,
  accessToken: string,
  init: {
    method?: GatewayMethod;
    body?: unknown;
    ifMatch?: string | number;
    idempotencyKey?: string;
  } = {},
): Promise<Response> {
  assertGatewayPath(path);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.ifMatch !== undefined) headers["If-Match"] = String(init.ifMatch);
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  return fetch(new URL(path, authConfig().gatewayUrl), {
    method: init.method ?? "GET",
    cache: "no-store",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15000),
  });
}

export async function gatewayGet(path: `/api/v1/${string}`, accessToken: string): Promise<Response> {
  return gatewayFetch(path, accessToken);
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") return record.error;
      if (typeof record.code === "string") return record.code;
      const nested = record.error;
      if (nested && typeof nested === "object" && typeof (nested as { code?: unknown }).code === "string") {
        return (nested as { code: string }).code;
      }
    }
  } catch {
    /* ignore non-JSON error bodies */
  }
  return undefined;
}

function unwrapData<T>(body: unknown): T {
  if (!body || typeof body !== "object") throw new Error("Gateway response is not an object");
  const record = body as Record<string, unknown>;
  if (!("data" in record)) throw new Error("Gateway response missing data envelope");
  return record.data as T;
}

async function gatewayData<T>(
  path: `/api/v1/${string}`,
  accessToken: string,
  init: {
    method?: GatewayMethod;
    body?: unknown;
    ifMatch?: string | number;
    idempotencyKey?: string;
    okStatuses?: number[];
  } = {},
): Promise<T> {
  const response = await gatewayFetch(path, accessToken, init);
  const okStatuses = init.okStatuses ?? [200];
  if (!okStatuses.includes(response.status)) {
    throw new ApiError(response.status, await readErrorCode(response));
  }
  return unwrapData<T>(await response.json());
}

export async function getMe(accessToken: string): Promise<Me> {
  const response = await gatewayGet("/api/v1/me", accessToken);
  if (!response.ok) throw new ApiError(response.status, await readErrorCode(response));
  const body: unknown = await response.json();
  if (!isMe(body)) throw new Error("Gateway /me response violates OpenAPI contract");
  return body;
}

export async function getOrganization(accessToken: string): Promise<Organization> {
  return gatewayData<Organization>("/api/v1/organization", accessToken);
}

export async function patchOrganization(
  accessToken: string,
  body: OrganizationPatch,
  version: number,
): Promise<Organization> {
  const { version: _ignored, ...fields } = body;
  void _ignored;
  return gatewayData<Organization>("/api/v1/organization", accessToken, {
    method: "PATCH",
    ifMatch: version,
    body: { ...fields, version },
  });
}

export async function listMembers(accessToken: string): Promise<Member[]> {
  return gatewayData<Member[]>("/api/v1/members", accessToken);
}

export async function createMember(accessToken: string, body: MemberCreate): Promise<Member> {
  return gatewayData<Member>("/api/v1/members", accessToken, {
    method: "POST",
    body,
    okStatuses: [201],
  });
}

export async function patchMember(
  accessToken: string,
  id: string,
  body: MemberPatch,
  version: number,
): Promise<Member> {
  const { version: _ignored, ...fields } = body;
  void _ignored;
  return gatewayData<Member>(`/api/v1/members/${id}`, accessToken, {
    method: "PATCH",
    ifMatch: version,
    body: { ...fields, version },
  });
}

export async function listPartners(accessToken: string): Promise<Partner[]> {
  return gatewayData<Partner[]>("/api/v1/partners", accessToken);
}

export async function createPartner(accessToken: string, body: PartnerCreate): Promise<Partner> {
  return gatewayData<Partner>("/api/v1/partners", accessToken, {
    method: "POST",
    body,
    okStatuses: [201],
  });
}

export async function patchPartner(
  accessToken: string,
  id: string,
  body: PartnerPatch,
  version: number,
): Promise<Partner> {
  const { version: _ignored, ...fields } = body;
  void _ignored;
  return gatewayData<Partner>(`/api/v1/partners/${id}`, accessToken, {
    method: "PATCH",
    ifMatch: version,
    body: { ...fields, version },
  });
}

export async function getPartnerConnection(
  accessToken: string,
  partnerId: string,
): Promise<PartnerConnectionView | null> {
  try {
    return await gatewayData<PartnerConnectionView>(
      `/api/v1/partners/${partnerId}/connection`,
      accessToken,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function putPartnerConnection(
  accessToken: string,
  partnerId: string,
  body: PartnerConnectionInput,
): Promise<PartnerConnectionView> {
  return gatewayData<PartnerConnectionView>(
    `/api/v1/partners/${partnerId}/connection`,
    accessToken,
    { method: "PUT", body },
  );
}

export async function listApprovalInbox(accessToken: string): Promise<ApprovalTask[]> {
  return gatewayData<ApprovalTask[]>("/api/v1/approvals/inbox", accessToken);
}

export async function getFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<FileMetadata | null> {
  try {
    return await gatewayData<FileMetadata>(`/api/v1/files/${fileId}`, accessToken);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
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

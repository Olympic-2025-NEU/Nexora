// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { AuthError, authErrorResponse } from "@/platform/identity/request-auth";
import { TokenError } from "@/platform/identity/token";
import { ActorResolutionError } from "@/platform/identity/resolve-actor";
import { PolicyError } from "@/platform/access/policy";
import { PartnerActorError } from "@/platform/identity/partner-actor";
import { SsrfError } from "@/platform/security/ssrf";
import type {
  MembershipRecord,
  OrganizationRecord,
  PartnerConnectionRecord,
  PartnerRecord,
} from "../domain/types";

export function ok<T>(data: T, requestId: string | null, status = 200): NextResponse {
  return NextResponse.json(
    { data, requestId: requestId ?? crypto.randomUUID() },
    { status, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

export function fail(
  code: string,
  status: number,
  requestId: string | null,
): NextResponse {
  return NextResponse.json(
    { error: code, status },
    { status, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

export function mapRouteError(err: unknown, requestId: string | null): NextResponse {
  if (err instanceof TokenError || err instanceof AuthError || err instanceof ActorResolutionError) {
    const status = (err as { httpStatus?: number }).httpStatus === 403 ? 403 : 401;
    return authErrorResponse((err as { code: string }).code, status as 401 | 403, requestId);
  }
  if (err instanceof PolicyError) return fail("POLICY_DENIED", 403, requestId);
  if (err instanceof PartnerActorError) return fail(err.code, err.httpStatus, requestId);
  if (err instanceof SsrfError) return fail(err.code, 422, requestId);
  if (err instanceof DomainError) return fail(err.code, err.httpStatus, requestId);
  if (err instanceof Error && err.message.includes("Unique constraint")) {
    return fail("CONFLICT", 409, requestId);
  }
  console.error("[system route] unexpected", err);
  return fail("INTERNAL_ERROR", 500, requestId);
}

export function projectOrganization(org: OrganizationRecord) {
  return {
    id: org.id,
    instanceId: org.instanceId,
    code: org.code,
    name: org.name,
    timezone: org.timezone,
    status: org.status,
    version: org.version,
    ...(org.contactEmail ? { contactEmail: org.contactEmail } : {}),
  };
}

export function projectMember(member: MembershipRecord) {
  return {
    id: member.id,
    keycloakSub: member.keycloakSub,
    displayName: member.displayName,
    ...(member.email ? { email: member.email } : {}),
    role: member.role,
    status: member.status,
    version: member.version,
    warehouseIds: [] as string[],
  };
}

export function projectPartner(partner: PartnerRecord, includeContact: boolean) {
  return {
    id: partner.id,
    issuerInstanceId: partner.issuerInstanceId,
    code: partner.code,
    displayName: partner.displayName,
    status: partner.status,
    version: partner.version,
    ...(includeContact && partner.contactEmail ? { contactEmail: partner.contactEmail } : {}),
    ...(partner.connectionStatus ? { connectionStatus: partner.connectionStatus } : {}),
  };
}

export function projectConnectionView(conn: PartnerConnectionRecord) {
  let endpointHost = "";
  try {
    endpointHost = new URL(conn.endpointUrl).host;
  } catch {
    endpointHost = "invalid";
  }
  return {
    partnerId: conn.partnerId,
    endpointHost,
    status: conn.status,
    ...(conn.rotatedAt ? { rotatedAt: conn.rotatedAt.toISOString() } : {}),
  };
}

export function parseIfMatchVersion(header: string | null, bodyVersion?: unknown): number | null {
  if (typeof bodyVersion === "number" && Number.isInteger(bodyVersion) && bodyVersion > 0) {
    return bodyVersion;
  }
  if (!header) return null;
  const raw = header.replace(/^W\//, "").replaceAll('"', "").trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

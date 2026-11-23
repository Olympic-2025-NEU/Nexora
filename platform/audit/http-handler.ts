// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PolicyError } from "../access/policy";
import type { Actor } from "../identity/actor";
import { AuthError } from "../identity/request-auth";
import { ActorResolutionError } from "../identity/resolve-actor";
import { TokenError } from "../identity/token";
import { AuditQueryError, listAuditForAdministrator, type AuditQueryRepository } from "./audit-query";
import { auditAuthenticationFailure, auditDeny, auditFailure } from "./security-audit";

export type AuditHttpDependencies = {
  resolveActor(request: NextRequest): Promise<Actor>;
  repository: AuditQueryRepository;
};

function response(status: number, code: string, requestId: string): NextResponse {
  const message = status === 400 ? "Invalid audit query" :
    status === 401 ? "Authentication required" :
      status === 403 ? "Forbidden" : "Audit query unavailable";
  return NextResponse.json({ code, message, requestId }, {
    status, headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

export async function handleAuditGet(request: NextRequest, deps: AuditHttpDependencies): Promise<NextResponse> {
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
  let actor: Actor;
  try {
    actor = await deps.resolveActor(request);
  } catch (error) {
    if (error instanceof TokenError || error instanceof AuthError || error instanceof ActorResolutionError) {
      const status = error.httpStatus === 403 ? 403 : 401;
      auditAuthenticationFailure("platform:audit:read", requestId, error.code);
      return response(status, error.code, requestId);
    }
    auditAuthenticationFailure("platform:audit:read", requestId, "AUTH_UNAVAILABLE", "failure");
    return response(503, "AUTH_UNAVAILABLE", requestId);
  }

  try {
    const page = await listAuditForAdministrator(actor, request.nextUrl.searchParams, deps.repository);
    return NextResponse.json({ ...page, requestId }, {
      status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId },
    });
  } catch (error) {
    if (error instanceof AuditQueryError) return response(400, error.code, requestId);
    if (error instanceof PolicyError) {
      auditDeny(actor, "platform:audit:read", requestId, "POLICY_DENIED");
      return response(403, "POLICY_DENIED", requestId);
    }
    auditFailure(actor, "platform:audit:read", requestId, "AUDIT_QUERY_FAILED");
    return response(503, "AUDIT_QUERY_FAILED", requestId);
  }
}

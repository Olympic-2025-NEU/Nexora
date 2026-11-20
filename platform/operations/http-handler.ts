// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import { AuthError } from "@/platform/identity/request-auth";
import { ActorResolutionError } from "@/platform/identity/resolve-actor";
import { TokenError } from "@/platform/identity/token";
import { checkPolicy } from "@/platform/access/policy";
import { auditAuthenticationFailure, auditDeny, auditFailure } from "@/platform/audit/security-audit";
import { requestId } from "@/platform/observability/health";
import { listRetries, retryMessage } from "@/platform/operations/retry-dead-letter";

type Dependencies = { resolveActor(request: NextRequest): Promise<Actor>; db: PrismaClient };
const action = "platform:operations:retry";
const reply = (id: string, body: object, status: number) => NextResponse.json({ ...body, requestId: id },
  { status, headers: { "x-request-id": id, "cache-control": "no-store" } });

export function createRetryHandlers(deps: () => Dependencies) {
  async function authorized(request: NextRequest, id: string) {
    let actor: Actor;
    try { actor = await deps().resolveActor(request); }
    catch (error) {
      if (error instanceof TokenError || error instanceof AuthError || error instanceof ActorResolutionError) {
        const status = error.httpStatus === 403 ? 403 : 401;
        auditAuthenticationFailure(action, id, error.code);
        return { error: reply(id, { code: error.code }, status) };
      }
      auditAuthenticationFailure(action, id, "AUTH_UNAVAILABLE", "failure");
      return { error: reply(id, { code: "AUTH_UNAVAILABLE" }, 503) };
    }
    if (!checkPolicy(actor, action).allowed) {
      auditDeny(actor, action, id, "POLICY_DENIED");
      return { error: reply(id, { code: "POLICY_DENIED" }, 403) };
    }
    return { actor };
  }

  return {
    async GET(request: NextRequest) {
      const id = requestId(request.headers.get("x-request-id"));
      const auth = await authorized(request, id);
      if (auth.error) return auth.error;
      try { return reply(id, await listRetries(deps().db, auth.actor!), 200); }
      catch { auditFailure(auth.actor!, action, id, "OPS_LIST_FAILED"); return reply(id, { code: "OPS_UNAVAILABLE" }, 503); }
    },
    async POST(request: NextRequest) {
      const id = requestId(request.headers.get("x-request-id"));
      const auth = await authorized(request, id);
      if (auth.error) return auth.error;
      let body: unknown;
      try { body = await request.json(); } catch { return reply(id, { code: "INVALID_BODY" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Object.hasOwn(body, "messageId") ||
          typeof (body as { messageId: unknown }).messageId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((body as { messageId: string }).messageId)) {
        return reply(id, { code: "INVALID_BODY" }, 400);
      }
      try {
        const result = await retryMessage(deps().db, auth.actor!, (body as { messageId: string }).messageId, id);
        const { httpStatus, ...body } = result;
        return reply(id, body, httpStatus);
      } catch { auditFailure(auth.actor!, action, id, "OPS_RETRY_FAILED"); return reply(id, { code: "OPS_UNAVAILABLE" }, 503); }
    },
  };
}

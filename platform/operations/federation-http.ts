// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../identity/actor";
import { AuthError } from "../identity/request-auth";
import { ActorResolutionError } from "../identity/resolve-actor";
import { TokenError } from "../identity/token";
import { checkPolicy } from "../access/policy";
import { auditAuthenticationFailure, auditDeny, auditFailure } from "../audit/security-audit";
import { requestId } from "../observability/health";
import { federationOperations, reprocessFederationInbox } from "./federation";

type Dependencies = { resolveActor(request: NextRequest): Promise<Actor>; db: PrismaClient };
const action = "platform:operations:retry";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (id: string, body: object, status: number) => NextResponse.json({ ...body, requestId: id },
  { status, headers: { "x-request-id": id, "cache-control": "no-store" } });

export function createFederationOperationsHandlers(deps: () => Dependencies) {
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
      const messageId = new URL(request.url).searchParams.get("messageId") ?? undefined;
      if (messageId && !uuid.test(messageId)) return reply(id, { code: "INVALID_MESSAGE_ID" }, 400);
      try { return reply(id, await federationOperations(deps().db, auth.actor!, messageId), 200); }
      catch { auditFailure(auth.actor!, action, id, "FEDERATION_OPS_LIST_FAILED");
        return reply(id, { code: "OPS_UNAVAILABLE" }, 503); }
    },
    async POST(request: NextRequest) {
      const id = requestId(request.headers.get("x-request-id"));
      const auth = await authorized(request, id);
      if (auth.error) return auth.error;
      let body: unknown;
      try { body = await request.json(); } catch { return reply(id, { code: "INVALID_BODY" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "action,inboxId" ||
          (body as { action?: unknown }).action !== "reprocess" ||
          typeof (body as { inboxId?: unknown }).inboxId !== "string" ||
          !uuid.test((body as { inboxId: string }).inboxId))
        return reply(id, { code: "INVALID_BODY" }, 400);
      try {
        const result = await reprocessFederationInbox(deps().db, auth.actor!,
          (body as { inboxId: string }).inboxId, id);
        const { httpStatus, ...responseBody } = result;
        return reply(id, responseBody, httpStatus);
      } catch { auditFailure(auth.actor!, action, id, "FEDERATION_REPROCESS_FAILED");
        return reply(id, { code: "OPS_UNAVAILABLE" }, 503); }
    },
  };
}

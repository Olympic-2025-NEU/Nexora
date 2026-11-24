// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { FederationContractError, validateFederationEnvelope } from "../contracts/events/federation";
import { PermanentDeliveryError, type OutboxHandler } from "../platform/outbox/message";
import { validatePartnerUrl } from "../platform/security/ssrf";

type Fetch = typeof fetch;
type Connection = { endpointUrl: string; outboundTokenUrl: string; outboundClientId: string;
  outboundSecretRef: string; outboundAudience: string; status: string;
  partner: { issuerInstanceId: string; status: string } };
type Outcome = { result: "ack" | "retry" | "permanent_failure"; code?: string; httpStatus?: number;
  ack?: { messageId: string; ackId: string; acceptedAt: string; status: "validated" | "pending_dependency" } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export async function resolveFederationSecret(ref: string): Promise<string> {
  const env = /^env:([A-Z][A-Z0-9_]*)$/.exec(ref);
  if (env) {
    const value = process.env[env[1]];
    if (value) return value;
  }
  const file = /^secret:([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(ref);
  if (file) {
    try {
      const value = (await readFile(`/run/secrets/${file[1]}`, "utf8")).trim();
      if (value) return value;
    } catch { /* resolved to a safe error below */ }
  }
  throw new PermanentDeliveryError("OUTBOUND_SECRET_UNAVAILABLE");
}

function safeEndpoint(url: string): string {
  try { validatePartnerUrl(url); }
  catch { throw new PermanentDeliveryError("INVALID_PARTNER_ENDPOINT"); }
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash) throw new PermanentDeliveryError("INVALID_PARTNER_ENDPOINT");
  return parsed.hostname;
}

function ackBody(value: unknown, messageId: string): Outcome["ack"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "acceptedAt,ackId,messageId,status" ||
      body.messageId !== messageId || typeof body.ackId !== "string" || !UUID.test(body.ackId) ||
      typeof body.acceptedAt !== "string" || !UTC_TIME.test(body.acceptedAt) ||
      Number.isNaN(Date.parse(body.acceptedAt)) ||
      (body.status !== "validated" && body.status !== "pending_dependency")) return undefined;
  return body as NonNullable<Outcome["ack"]>;
}

function failure(code: string, permanent: boolean, httpStatus?: number): Outcome {
  return { result: permanent ? "permanent_failure" : "retry", code, httpStatus };
}

export function createFederationOutboundHandler(db: PrismaClient, issuerInstanceId: string, options: {
  fetcher?: Fetch; resolveSecret?: (ref: string) => Promise<string>;
  validateUrl?: (url: string) => string;
} = {}): OutboxHandler {
  const fetcher = options.fetcher ?? fetch;
  const resolveSecret = options.resolveSecret ?? resolveFederationSecret;
  const validateUrl = options.validateUrl ?? safeEndpoint;
  if (!issuerInstanceId) throw new Error("NEXORA_ISSUER_INSTANCE_ID is required");
  return async (message) => {
    const started = Date.now();
    let endpointHost = "unconfigured";
    let outcome: Outcome;
    try {
      if (message.destination !== "federation" || message.eventType !== "transfer.announced.v1" ||
          message.schemaVersion !== "1") throw new PermanentDeliveryError("UNSUPPORTED_EVENT_TYPE");
      const raw = JSON.stringify(message.payload);
      const checked = validateFederationEnvelope(raw, { partnerIssuerInstanceId: issuerInstanceId });
      if (checked.envelope.eventType !== message.eventType) throw new PermanentDeliveryError("EVENT_TYPE_MISMATCH");
      const connection = await db.partnerConnection.findFirst({
        where: { partner: { issuerInstanceId: checked.envelope.recipientInstanceId } },
        include: { partner: { select: { issuerInstanceId: true, status: true } } },
      }) as Connection | null;
      if (!connection || connection.status !== "active" || connection.partner.status !== "active")
        throw new PermanentDeliveryError("PARTNER_CONNECTION_INACTIVE");
      endpointHost = validateUrl(connection.endpointUrl);
      validateUrl(connection.outboundTokenUrl);
      const secret = await resolveSecret(connection.outboundSecretRef);
      const token = async () => {
        const form = new URLSearchParams({ grant_type: "client_credentials",
          client_id: connection.outboundClientId, client_secret: secret,
          scope: "federation:write", audience: connection.outboundAudience });
        const response = await fetcher(connection.outboundTokenUrl, { method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" }, body: form,
          signal: AbortSignal.timeout(5_000), redirect: "error" });
        if (response.status === 400 || response.status === 401 || response.status === 403)
          throw new PermanentDeliveryError("OUTBOUND_CREDENTIAL_REVOKED");
        if (!response.ok) throw new Error("TOKEN_ENDPOINT_UNAVAILABLE");
        const body = await response.json() as Record<string, unknown>;
        if (typeof body.access_token !== "string" || !body.access_token || body.token_type !== "Bearer")
          throw new Error("INVALID_TOKEN_RESPONSE");
        return body.access_token;
      };
      let bearer = await token();
      let response: Response | undefined;
      for (let index = 0; index < 2; index++) {
        response = await fetcher(connection.endpointUrl, { method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json",
            "x-correlation-id": checked.envelope.correlationId },
          body: raw, signal: AbortSignal.timeout(10_000), redirect: "error" });
        if (response.status !== 401 || index === 1) break;
        bearer = await token(); // expired token: refresh client credentials once
      }
      if (response!.status === 401 || response!.status === 403)
        outcome = failure("OUTBOUND_CREDENTIAL_REVOKED", true, response!.status);
      else if (response!.status === 202) {
        const text = await response!.text();
        let body: unknown = null;
        if (text.length <= 8_192) {
          try { body = JSON.parse(text) as unknown; } catch { /* invalid ACK */ }
        }
        const ack = ackBody(body, checked.envelope.messageId);
        outcome = ack ? { result: "ack", httpStatus: 202, ack } : failure("INVALID_ACK", false, 202);
      } else if (response!.status === 409 || response!.status === 413 || response!.status === 422)
        outcome = failure(`PARTNER_REJECTED_${response!.status}`, true, response!.status);
      else outcome = failure("PARTNER_UNAVAILABLE", false, response!.status);
    } catch (error) {
      const code = error instanceof PermanentDeliveryError ? error.reason :
        error instanceof FederationContractError ? error.code :
          error instanceof Error && error.message === "TOKEN_ENDPOINT_UNAVAILABLE" ? "TOKEN_ENDPOINT_UNAVAILABLE" :
            error instanceof Error && error.message === "INVALID_TOKEN_RESPONSE" ? "INVALID_TOKEN_RESPONSE" :
              error instanceof Error && error.name === "TimeoutError" ? "OUTBOUND_TIMEOUT" : "OUTBOUND_UNAVAILABLE";
      outcome = failure(code, error instanceof PermanentDeliveryError || error instanceof FederationContractError);
    }
    const durationMs = Math.max(0, Date.now() - started);
    const data = { id: randomUUID(), outboxId: message.id,
      endpointHost, httpStatus: outcome.httpStatus ?? null, result: outcome.result,
      errorCode: outcome.code ?? null, durationMs,
      ackMessageId: outcome.ack?.messageId ?? null, ackId: outcome.ack?.ackId ?? null,
      ackStatus: outcome.ack?.status ?? null };
    await db.$transaction(async (tx) => {
      // Admin retry resets outbox.attempt_count. Keep the audit sequence monotonic
      // under the outbox row lock, including retries after a dead letter.
      await tx.$queryRaw`SELECT id FROM platform.outbox_message WHERE id = ${message.id}::uuid FOR UPDATE`;
      const previous = await tx.deliveryAttempt.aggregate({ where: { outboxId: message.id },
        _max: { attemptNo: true } });
      await tx.deliveryAttempt.create({ data: { ...data, attemptNo: (previous._max.attemptNo ?? 0) + 1 } });
      if (outcome.result === "ack") {
        await tx.transferDetail.updateMany({ where: { documentId: message.aggregateId,
          deliveryState: "pending" }, data: { deliveryState: "technical_ack",
          technicalAckAt: new Date(outcome.ack!.acceptedAt) } });
      }
    });
    if (outcome.result === "ack") {
      console.log(JSON.stringify({ service: "federation-outbound", messageId: message.id,
        recipientInstanceId: (message.payload as { recipientInstanceId?: string }).recipientInstanceId,
        outcome: "ack", attempt: message.attemptCount }));
      return;
    }
    console.error(JSON.stringify({ service: "federation-outbound", messageId: message.id,
      outcome: outcome.result, code: outcome.code, attempt: message.attemptCount }));
    if (outcome.result === "permanent_failure") throw new PermanentDeliveryError(outcome.code!);
    const retry = new Error(outcome.code);
    Object.assign(retry, { code: outcome.code });
    throw retry;
  };
}

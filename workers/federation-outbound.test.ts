// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createFederationOutboundHandler } from "./federation-outbound";
import type { OutboxMessage } from "../platform/outbox/message";

const payload = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
const receiptPayload = JSON.parse(readFileSync("contracts/events/fixtures/b-to-a-receipt-confirmed.json", "utf8"));
const ack = () => ({ messageId: payload.messageId, ackId: randomUUID(),
  acceptedAt: "2026-11-14T08:00:02Z", status: "validated" });
const connection = { endpointUrl: "https://partner.example/api/v1/federation/events",
  outboundTokenUrl: "https://identity.example/token", outboundClientId: "client-a",
  outboundSecretRef: "env:PARTNER_SECRET", outboundAudience: "partner-b", status: "active",
  partner: { issuerInstanceId: "B", status: "active" } };
function fixture(activeConnection = connection, activePayload = payload) {
  const attempts: Array<Record<string, unknown>> = [];
  const states: Array<Record<string, unknown>> = [];
  let inTransaction = false;
  const db = {
    partnerConnection: { findFirst: async () => activeConnection },
    deliveryAttempt: {
      aggregate: async () => ({ _max: { attemptNo: attempts.at(-1)?.attemptNo ?? null } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { attempts.push(data); },
    },
    transferDetail: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { states.push(data); } },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try { return await fn(db); } finally { inTransaction = false; }
    },
  };
  const message = { id: randomUUID(), aggregateId: activePayload.sourceDocument.id,
    eventType: activePayload.eventType, schemaVersion: "1", destination: "federation",
    payload: activePayload, correlationId: activePayload.correlationId, attemptCount: 1 } as OutboxMessage;
  return { db: db as unknown as PrismaClient, attempts, states, message,
    inTransaction: () => inTransaction };
}
const tokenResponse = () => new Response(JSON.stringify({ access_token: "ephemeral-token", token_type: "Bearer" }),
  { status: 200 });
const ackResponse = (body: unknown = ack()) => new Response(JSON.stringify(body), { status: 202 });

test("valid ACK marks transfer only after HTTP, records redacted attempt", async () => {
  const f = fixture();
  const requests: string[] = [];
  const handler = createFederationOutboundHandler(f.db, "A", {
    resolveSecret: async () => "test-secret",
    fetcher: async (url, init) => {
      assert.equal(f.inTransaction(), false, "HTTP must run outside application transaction");
      requests.push(String(url));
      if (String(url).includes("identity")) return tokenResponse();
      assert.equal(init?.body, JSON.stringify(payload));
      return ackResponse();
    },
  });
  await handler(f.message);
  assert.deepEqual(requests, [connection.outboundTokenUrl, connection.endpointUrl]);
  assert.equal(f.attempts[0].result, "ack");
  assert.equal(f.attempts[0].ackMessageId, payload.messageId);
  assert.equal(f.attempts[0].endpointHost, "partner.example");
  assert.equal(f.states[0].deliveryState, "technical_ack");
  assert.ok(!JSON.stringify(f.attempts).includes("test-secret"));
  assert.ok(!JSON.stringify(f.attempts).includes("ephemeral-token"));
});

test("business receipt delivers with ACK but does not mark a transfer technical ACK", async () => {
  const f = fixture({ ...connection, partner: { issuerInstanceId: "A", status: "active" } }, receiptPayload);
  await createFederationOutboundHandler(f.db, "B", {
    resolveSecret: async () => "test-secret",
    fetcher: async (url) => String(url).includes("identity") ? tokenResponse() :
      ackResponse({ messageId: receiptPayload.messageId, ackId: randomUUID(),
        acceptedAt: "2026-11-14T10:00:02Z", status: "validated" }),
  })(f.message);
  assert.equal(f.attempts[0].result, "ack");
  assert.equal(f.states.length, 0);
});

test("B offline and lost ACK keep same payload for a restarted worker retry", async () => {
  const f = fixture();
  const sentBodies: string[] = [];
  let sends = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("identity")) return tokenResponse();
    sentBodies.push(String(init?.body));
    sends++;
    if (sends <= 2) throw new Error(sends === 1 ? "B offline" : "ACK lost after inbox commit");
    return ackResponse();
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const handler = createFederationOutboundHandler(f.db, "A", {
      resolveSecret: async () => "test-secret", fetcher });
    const message = { ...f.message, attemptCount: attempt };
    if (attempt < 3) await assert.rejects(handler(message), { code: "OUTBOUND_UNAVAILABLE" });
    else await handler(message);
  }
  assert.equal(f.attempts.length, 3);
  assert.deepEqual(f.attempts.map((row) => row.attemptNo), [1, 2, 3]);
  assert.deepEqual(f.attempts.map((row) => row.result), ["retry", "retry", "ack"]);
  assert.equal(f.states.length, 1);
  assert.ok(sentBodies.every((body) => body === sentBodies[0]));
  assert.equal(JSON.parse(sentBodies[0]).messageId, payload.messageId);
});

test("admin retry reset keeps delivery attempt numbers monotonic", async () => {
  const f = fixture();
  const handler = createFederationOutboundHandler(f.db, "A", {
    resolveSecret: async () => "test-secret",
    fetcher: async (url) => String(url).includes("identity") ? tokenResponse() :
      new Response("reject", { status: 422 }),
  });
  await assert.rejects(handler({ ...f.message, attemptCount: 1 }));
  await assert.rejects(handler({ ...f.message, attemptCount: 1 }));
  assert.deepEqual(f.attempts.map((row) => row.attemptNo), [1, 2]);
});

test("mismatched ACK never delivers; expired token refreshes once", async () => {
  const f = fixture();
  let tokens = 0;
  let events = 0;
  const fetcher: typeof fetch = async (url) => {
    if (String(url).includes("identity")) { tokens++; return tokenResponse(); }
    events++;
    return events === 1 ? new Response("", { status: 401 }) :
      ackResponse({ ...ack(), messageId: randomUUID() });
  };
  await assert.rejects(createFederationOutboundHandler(f.db, "A", {
    resolveSecret: async () => "test-secret", fetcher })(f.message), { code: "INVALID_ACK" });
  assert.equal(tokens, 2);
  assert.equal(events, 2);
  assert.equal(f.attempts[0].result, "retry");
  assert.equal(f.states.length, 0);
});

test("revoked credentials and permanent rejection dead-letter without tokens in logs", async () => {
  const f = fixture();
  await assert.rejects(createFederationOutboundHandler(f.db, "A", {
    resolveSecret: async () => "test-secret",
    fetcher: async () => new Response("revoked", { status: 401 }),
  })(f.message), { reason: "OUTBOUND_CREDENTIAL_REVOKED" });
  assert.equal(f.attempts[0].result, "permanent_failure");
  assert.equal(f.states.length, 0);
  const g = fixture();
  await assert.rejects(createFederationOutboundHandler(g.db, "A", {
    resolveSecret: async () => "test-secret",
    fetcher: async (url) => String(url).includes("identity") ? tokenResponse() :
      new Response("invalid", { status: 422 }),
  })(g.message), { reason: "PARTNER_REJECTED_422" });
  assert.equal(g.attempts[0].result, "permanent_failure");
});

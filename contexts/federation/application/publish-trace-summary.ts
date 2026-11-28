// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { DomainError } from "../../../platform/kernel/errors";
import { prismaAuditRecorder } from "../../../platform/audit/prisma-audit-recorder";
import { validateFederationEnvelope } from "../../../contracts/events/federation";

type Ref = { issuerInstanceId: string; externalEventId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin explicitly queues an allowlisted, versioned local snapshot for one connected partner. */
export async function publishTraceSummary(db: PrismaClient, actor: Actor,
  batchId: string, recipientInstanceId: string, requestId: string) {
  if (!checkPolicy(actor, "trace:federation:publish").allowed)
    throw new DomainError("POLICY_DENIED", 403);
  if (!UUID.test(batchId) || !recipientInstanceId || recipientInstanceId.length > 64)
    throw new DomainError("TRACE_SUMMARY_INVALID", 422);
  const issuerInstanceId = process.env.NEXORA_ISSUER_INSTANCE_ID;
  if (!issuerInstanceId) throw new DomainError("INSTANCE_NOT_CONFIGURED", 503);
  return db.$transaction(async (tx) => {
    const [batch, connection, policy] = await Promise.all([
      tx.batch.findUnique({ where: { id: batchId } }),
      tx.partnerConnection.findFirst({ where: { partner: { issuerInstanceId: recipientInstanceId } },
        include: { partner: true } }),
      tx.passportPolicy.findFirst({ where: { batchId, state: { in: ["approved", "revoked"] } },
        orderBy: { policyVersion: "desc" } }),
    ]);
    if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);
    if (!connection || connection.status !== "active" || connection.partner.status !== "active")
      throw new DomainError("PARTNER_CONNECTION_INACTIVE", 409);
    if (!policy || !["partner", "public"].includes(policy.timelineVisibility))
      throw new DomainError("TRACE_SHARE_POLICY_REQUIRED", 409);
    const events = await tx.traceEvent.findMany({ where: { batchId },
      include: { outgoing: { include: { toEvent: { select: {
        issuerInstanceId: true, externalEventId: true } } } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 101 });
    if (events.length > 100) throw new DomainError("TRACE_SUMMARY_TOO_LARGE", 422);
    const grants = await tx.federatedTraceSummary.findMany({ where: { batchId }, take: 101 });
    const grantByEvent = new Map(grants.map((grant) =>
      [`${grant.issuerInstanceId}:${grant.externalEventId}`, grant]));
    const selected = events.flatMap((event) => {
      if (event.issuerInstanceId === issuerInstanceId &&
          event.verificationState === "local_verified")
        return [{ event, disclosureScope: policy.timelineVisibility as "partner" | "public",
          policyVersion: policy.policyVersion,
          state: policy.state === "revoked" ? "revoked" as const : "active" as const }];
      const grant = grantByEvent.get(`${event.issuerInstanceId}:${event.externalEventId}`);
      if (grant?.disclosureScope !== "public") return [];
      return [{ event, disclosureScope: "public" as const,
        policyVersion: grant.policyVersion, state: grant.state as "active" | "revoked" }];
    });
    if (!selected.length || !selected.some((row) => row.event.issuerInstanceId === issuerInstanceId))
      throw new DomainError("TRACE_SUMMARY_EMPTY", 409);
    const included = new Set(selected.map(({ event }) =>
      `${event.issuerInstanceId}:${event.externalEventId}`));
    const traceSummaries = await Promise.all(selected.map(async ({ event, ...grant }) => {
      const source = event.sourceMessageId ? await tx.inboxMessage.findUnique({
        where: { id: event.sourceMessageId }, select: {
          issuerInstanceId: true, messageId: true, eventId: true, eventType: true } }) : null;
      const saved = event.summary as { sourceMessageRef?: unknown } | null;
      const sourceMessageRef = source?.eventType === "transfer.announced.v1"
        ? { issuerInstanceId: source.issuerInstanceId, messageId: source.messageId,
          eventId: source.eventId } : saved?.sourceMessageRef;
      const parents = event.outgoing.flatMap((link): Ref[] => {
        if (!link.toEvent) return [];
        const key = `${link.toEvent.issuerInstanceId}:${link.toEvent.externalEventId}`;
        return included.has(key) ? [link.toEvent] : [];
      });
      return { issuerInstanceId: event.issuerInstanceId,
        externalEventId: event.externalEventId, eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(), ...grant, parents,
        ...(sourceMessageRef ? { sourceMessageRef } : {}) };
    }));
    // The business transfer and its federation envelope have distinct IDs. Grant the
    // exact envelope event so a receiver can relay only what this policy published.
    const announced = await tx.outboxMessage.findMany({ where: {
      eventType: "transfer.announced.v1", aggregateId: {
        in: events.flatMap((event) => event.issuerInstanceId === issuerInstanceId &&
          event.eventType === "trading.transfer.confirmed.v1" && event.documentId
          ? [event.documentId] : []) },
    }, take: 101 });
    for (const row of announced) {
      const payload = row.payload as { eventId?: string; messageId?: string;
        occurredAt?: string; lots?: Array<{ sourceLineId?: string;
          senderBatch?: { batchId?: string }; originLot?: Ref & { lotId?: string } }> };
      if (!payload.eventId || !payload.messageId || !payload.occurredAt) continue;
      const parent = traceSummaries.find((item) => item.issuerInstanceId === issuerInstanceId &&
        item.eventType === "trading.transfer.confirmed.v1" &&
        events.some((event) => event.externalEventId === item.externalEventId &&
          event.documentId === row.aggregateId));
      for (const lot of payload.lots ?? []) {
        if (lot.senderBatch?.batchId !== batchId || !lot.sourceLineId ||
            lot.originLot?.issuerInstanceId !== batch.originIssuerInstanceId ||
            lot.originLot?.lotId !== batch.originLotId) continue;
        traceSummaries.push({ issuerInstanceId, externalEventId: `${payload.eventId}:${lot.sourceLineId}`,
          eventType: "transfer.announced.v1", occurredAt: payload.occurredAt,
          disclosureScope: policy.timelineVisibility as "partner" | "public",
          policyVersion: policy.policyVersion,
          state: policy.state === "revoked" ? "revoked" : "active",
          parents: parent ? [{ issuerInstanceId, externalEventId: parent.externalEventId }] : [],
          sourceMessageRef: { issuerInstanceId, messageId: payload.messageId,
            eventId: payload.eventId } });
      }
    }
    if (traceSummaries.length > 100) throw new DomainError("TRACE_SUMMARY_TOO_LARGE", 422);
    const now = new Date().toISOString();
    const messageId = randomUUID();
    const payload = { schemaVersion: "1.0", messageId, eventId: randomUUID(),
      eventType: "trace.summary.v1", issuerInstanceId, recipientInstanceId,
      occurredAt: now, publishedAt: now, correlationId: requestId,
      causationId: batchId, sourceDocument: { type: "trace_summary", id: batchId,
        version: policy.policyVersion }, lots: [], upstreamReferences: [], evidence: [],
      sharingPolicyVersion: "v1",
      targetLot: { originLot: { issuerInstanceId: batch.originIssuerInstanceId,
        lotId: batch.originLotId }, senderBatch: { instanceId: issuerInstanceId,
        batchId } }, traceSummaries };
    try { validateFederationEnvelope(JSON.stringify(payload)); }
    catch { throw new DomainError("TRACE_SUMMARY_INVALID", 422); }
    await tx.outboxMessage.create({ data: { id: messageId, aggregateType: "trace_summary",
      aggregateId: messageId, aggregateVersion: 1,
      eventType: "trace.summary.v1", schemaVersion: "1",
      payload: payload as Prisma.InputJsonObject, destination: "federation",
      correlationId: requestId } });
    await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
      action: "trace.summary.publish", targetType: "batch", targetId: batchId,
      requestId, after: { recipientInstanceId, policyVersion: policy.policyVersion,
        eventCount: traceSummaries.length, messageId } });
    return { messageId, eventCount: traceSummaries.length,
      policyVersion: policy.policyVersion, state: "pending" as const };
  });
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../identity/actor";
import { requirePolicy } from "../access/policy";
import { prismaAuditRecorder } from "../audit/prisma-audit-recorder";
import { safeErrorCode } from "../observability/diagnostics";
import { MappingError, resolveInbox } from "../../contexts/federation/application/identity-mapping";

const age = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
const safeId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;

/** Operator view deliberately excludes payload, endpoint secrets, client IDs and raw error text. */
export async function federationOperations(db: PrismaClient, actor: Actor, messageId?: string) {
  requirePolicy(actor, "platform:operations:retry");
  const [queue, inboxStates, transferStates, failures, pending, outboxIds,
    oldest, attemptStates, receiptCases] = await Promise.all([
    db.outboxMessage.groupBy({ by: ["status"], where: { destination: "federation" }, _count: { id: true } }),
    db.inboxMessage.groupBy({ by: ["state"], _count: { id: true } }),
    db.transferDetail.groupBy({ by: ["deliveryState"], where: { document: { status: "confirmed" } },
      _count: { documentId: true } }),
    db.outboxMessage.findMany({ where: { destination: "federation", status: "dead_letter" },
      orderBy: { createdAt: "asc" }, take: 25, select: { id: true, eventType: true,
        correlationId: true, attemptCount: true, lastErrorCode: true, createdAt: true } }),
    db.inboxMessage.findMany({ where: { state: { in: ["pending_dependency", "rejected"] } },
      orderBy: { receivedAt: "asc" }, take: 25, select: { id: true, issuerInstanceId: true,
        messageId: true, eventType: true, state: true, errorCode: true, receivedAt: true } }),
    messageId ? db.$queryRaw<{ id: string; envelope_message_id: string | null }[]>`
      SELECT id, payload->>'messageId' AS envelope_message_id FROM platform.outbox_message
      WHERE destination = 'federation'
        AND (id = ${messageId}::uuid OR payload->>'messageId' = ${messageId}) LIMIT 20` : Promise.resolve([]),
    db.outboxMessage.findFirst({ where: { destination: "federation",
      status: { in: ["pending", "leased", "retry_due"] } }, orderBy: { createdAt: "asc" },
    select: { createdAt: true } }),
    db.deliveryAttempt.groupBy({ by: ["result"], _count: { id: true } }),
    db.transferDetail.findMany({ where: { deliveryState: { in: ["pending", "technical_ack", "partial", "disputed"] },
      document: { status: "confirmed" } }, take: 25,
    select: { documentId: true, deliveryState: true, businessReceiptAt: true,
      document: { select: { createdAt: true } } } }),
  ]);
  const outbox = outboxIds.length ? await db.outboxMessage.findMany({ where: { id: { in: outboxIds.map((row) => row.id) } },
    select: { id: true, eventType: true, status: true, correlationId: true, attemptCount: true,
      lastErrorCode: true, createdAt: true, deliveredAt: true,
      deliveryAttempts: { orderBy: { attemptNo: "asc" }, select: { attemptNo: true, result: true,
        httpStatus: true, errorCode: true, durationMs: true, ackStatus: true, createdAt: true } } } }) : [];
  const inbound = messageId ? await db.inboxMessage.findMany({ where: { messageId }, take: 20,
    select: { id: true, issuerInstanceId: true, messageId: true, eventType: true, state: true,
      errorCode: true, receivedAt: true, appliedAt: true, ack: { select: { ackStatus: true } } } }) : [];
  return {
    instanceId: process.env.NEXORA_ISSUER_INSTANCE_ID ?? "unknown",
    queue: Object.fromEntries(queue.map((row) => [row.status, row._count.id])),
    queueOldestAgeSeconds: oldest ? age(oldest.createdAt) : 0,
    attempts: Object.fromEntries(attemptStates.map((row) => [row.result, row._count.id])),
    inbox: Object.fromEntries(inboxStates.map((row) => [row.state, row._count.id])),
    receipts: Object.fromEntries(transferStates.map((row) => [row.deliveryState, row._count.documentId])),
    deadLetters: failures.map((row) => ({ messageId: row.id, eventType: row.eventType,
      correlationId: safeId(row.correlationId), attempts: row.attemptCount,
      errorCode: safeErrorCode(row.lastErrorCode), ageSeconds: age(row.createdAt) })),
    mappingGaps: pending.map((row) => ({ inboxId: row.id, issuerInstanceId: row.issuerInstanceId,
      messageId: row.messageId, eventType: row.eventType, state: row.state,
      errorCode: safeErrorCode(row.errorCode), ageSeconds: age(row.receivedAt) })),
    receiptCases: receiptCases.map((row) => ({ transferId: row.documentId,
      state: row.deliveryState, ageSeconds: age(row.document.createdAt),
      businessReceiptAt: row.businessReceiptAt?.toISOString() ?? null })),
    lookup: messageId ? {
      outbox: outbox.map((row) => ({ outboxId: row.id,
        envelopeMessageId: outboxIds.find((item) => item.id === row.id)?.envelope_message_id ?? null,
        eventType: row.eventType, status: row.status,
        correlationId: safeId(row.correlationId), attemptCount: row.attemptCount,
        errorCode: safeErrorCode(row.lastErrorCode), ageSeconds: age(row.createdAt),
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        attempts: row.deliveryAttempts.map((attempt) => ({ number: attempt.attemptNo,
          result: attempt.result, httpStatus: attempt.httpStatus,
          errorCode: safeErrorCode(attempt.errorCode), durationMs: attempt.durationMs,
          ackStatus: attempt.ackStatus, at: attempt.createdAt.toISOString() })) })),
      inbox: inbound.map((row) => ({ inboxId: row.id, issuerInstanceId: row.issuerInstanceId,
        messageId: row.messageId, eventType: row.eventType, state: row.state,
        errorCode: safeErrorCode(row.errorCode), ackStatus: row.ack?.ackStatus ?? null,
        ageSeconds: age(row.receivedAt), appliedAt: row.appliedAt?.toISOString() ?? null })),
    } : null,
  };
}

export async function reprocessFederationInbox(db: PrismaClient, actor: Actor,
  inboxId: string, requestId: string) {
  requirePolicy(actor, "platform:operations:retry");
  const reprocess = () => db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; state: string; message_id: string }[]>`
      SELECT id, state, message_id FROM federation.inbox_message WHERE id = ${inboxId}::uuid FOR UPDATE`;
    const row = locked[0];
    if (!row) return { httpStatus: 404, code: "NOT_FOUND" } as const;
    if (row.state !== "pending_dependency")
      return { httpStatus: 409, code: "NOT_PENDING_DEPENDENCY", state: row.state } as const;
    const state = await resolveInbox(tx, inboxId);
    const auditId = await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
      action: "federation.inbox.reprocessed", targetType: "inbox_message", targetId: inboxId,
      requestId, correlationId: row.message_id,
      before: { state: row.state }, after: { state } });
    return { httpStatus: 202, state, auditId } as const;
  });
  try { return await reprocess(); }
  catch (error) {
    if (!(error instanceof MappingError)) throw error;
    return db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ state: string; message_id: string }[]>`
        SELECT state, message_id FROM federation.inbox_message WHERE id = ${inboxId}::uuid FOR UPDATE`;
      const row = locked[0];
      if (!row) return { httpStatus: 404, code: "NOT_FOUND" } as const;
      if (row.state !== "pending_dependency")
        return { httpStatus: 409, code: "NOT_PENDING_DEPENDENCY", state: row.state } as const;
      await tx.inboxMessage.update({ where: { id: inboxId }, data: {
        state: "rejected", errorCode: error.code } });
      const auditId = await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
        action: "federation.inbox.reprocessed", targetType: "inbox_message", targetId: inboxId,
        requestId, correlationId: row.message_id,
        before: { state: row.state }, after: { state: "rejected", code: safeErrorCode(error.code) } });
      return { httpStatus: 202, state: "rejected", code: safeErrorCode(error.code), auditId } as const;
    });
  }
}

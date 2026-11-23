// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../identity/actor";
import { requirePolicy } from "../access/policy";
import { prismaAuditRecorder } from "../audit/prisma-audit-recorder";
import { retryDeadLetter } from "../outbox/admin";
import { safeErrorCode, safeHaltReason } from "../observability/diagnostics";

export async function listRetries(db: PrismaClient, actor: Actor) {
  requirePolicy(actor, "platform:operations:retry");
  const [messages, approvals] = await Promise.all([
    db.outboxMessage.findMany({ where: { status: "dead_letter" }, orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, eventType: true, destination: true, aggregateId: true, attemptCount: true,
        lastErrorCode: true, correlationId: true, createdAt: true } }),
    db.approvalRequest.findMany({ where: { state: "halted" }, orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, documentId: true, haltReason: true, flowableProcessId: true, createdAt: true } }),
  ]);
  const age = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  return {
    deadLetters: messages.map(({ createdAt, lastErrorCode, ...row }) => ({ ...row,
      lastErrorCode: safeErrorCode(lastErrorCode), ageSeconds: age(createdAt) })),
    haltedApprovals: approvals.map(({ createdAt, haltReason, ...row }) => ({ ...row,
      haltReason: safeHaltReason(haltReason), ageSeconds: age(createdAt) })),
  };
}

export async function retryMessage(db: PrismaClient, actor: Actor, messageId: string, requestId: string) {
  requirePolicy(actor, "platform:operations:retry");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; correlation_id: string; last_error_code: string | null }[]>`
      SELECT status, correlation_id, last_error_code FROM platform.outbox_message
      WHERE id = ${messageId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) return { httpStatus: 404, code: "NOT_FOUND" } as const;
    if (row.status !== "dead_letter") return { httpStatus: 409, code: "NOT_DEAD_LETTER", status: row.status } as const;
    if (!await retryDeadLetter(tx, messageId)) return { httpStatus: 409, code: "NOT_DEAD_LETTER" } as const;
    const auditId = await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
      action: "outbox.dead_letter.retried", targetType: "outbox_message", targetId: messageId,
      requestId, correlationId: row.correlation_id,
      before: { status: "dead_letter", lastErrorCode: safeErrorCode(row.last_error_code) },
      after: { status: "pending" } });
    return { httpStatus: 202, status: "pending", auditId } as const;
  });
}

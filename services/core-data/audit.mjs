// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

/** The caller must supply the same Prisma transaction as the resource write. */
export function recordCoreAudit(tx, { actorSub, clientId, action, targetType, targetId,
  requestId, correlationId, afterSummary = {} }) {
  return tx.auditLog.create({ data: {
    id: randomUUID(), actorSub: actorSub ?? null, clientId: clientId ?? null,
    action, targetType, targetId, outcome: 'success', requestId,
    correlationId: correlationId ?? null, afterSummary,
  } });
}

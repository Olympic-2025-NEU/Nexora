// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { PermanentDeliveryError, type OutboxHandler, type OutboxMessage } from "./message";

type Settings = {
  client: PrismaClient;
  handlers: Map<string, OutboxHandler>;
  workerId: string;
  leaseMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
};

export function createOutboxDispatcher({ client, handlers, workerId, leaseMs = 30_000,
  batchSize = 10, maxAttempts = 8, baseBackoffMs = 2_000, maxBackoffMs = 300_000 }: Settings) {
  if (!workerId || !Number.isInteger(leaseMs) || leaseMs <= 0 || !Number.isInteger(batchSize) || batchSize <= 0 ||
      !Number.isInteger(maxAttempts) || maxAttempts <= 0 || baseBackoffMs <= 0 || maxBackoffMs <= 0) {
    throw new Error("Invalid outbox dispatcher settings");
  }
  const log = (message: OutboxMessage, outcome: string) => console.log(JSON.stringify({
    service: "outbox-dispatcher", messageId: message.id, correlationId: message.correlationId,
    destination: message.destination, attempt: message.attemptCount, outcome,
  }));
  return {
    async tick() {
      const claimed = await client.$transaction(async (tx) => {
        const exhausted = await tx.$queryRaw<{ id: string }[]>`
          UPDATE platform.outbox_message SET status = 'dead_letter', lease_owner = NULL,
            lease_until = NULL, last_error_code = 'LEASE_EXPIRED'
          WHERE status = 'leased' AND lease_until < now() AND attempt_count >= ${maxAttempts}
          RETURNING id`;
        const ids = await tx.$queryRaw<{ id: string }[]>`
          UPDATE platform.outbox_message SET status = 'leased', lease_owner = ${workerId},
            lease_until = now() + (${leaseMs} * interval '1 millisecond'), attempt_count = attempt_count + 1
          WHERE id IN (
            SELECT m.id FROM platform.outbox_message m
            WHERE m.attempt_count < ${maxAttempts}
              AND ((m.status IN ('pending','retry_due') AND m.next_attempt_at <= now())
                OR (m.status = 'leased' AND m.lease_until < now()))
              AND NOT EXISTS (
                SELECT 1 FROM platform.outbox_message o
                WHERE o.aggregate_type = m.aggregate_type AND o.aggregate_id = m.aggregate_id
                  AND o.destination = m.destination AND o.aggregate_version < m.aggregate_version
                  AND o.status IN ('pending','leased','retry_due')
              )
            ORDER BY m.next_attempt_at, m.created_at
            LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
          ) RETURNING id`;
        return { claimed: await tx.outboxMessage.findMany({ where: { id: { in: ids.map((row) => row.id) } } }),
          exhausted: await tx.outboxMessage.findMany({ where: { id: { in: exhausted.map((row) => row.id) } } }) };
      });
      const result = { claimed: claimed.claimed.length, delivered: 0, retried: 0,
        deadLettered: claimed.exhausted.length, leaseLost: 0 };
      for (const row of claimed.exhausted) log(row as OutboxMessage, "dead_letter");
      for (const row of claimed.claimed) {
        const message = row as OutboxMessage;
        let errorCode: string | undefined;
        let permanent = false;
        try {
          const handler = handlers.get(message.destination);
          if (!handler) errorCode = "UNKNOWN_DESTINATION";
          else await handler(message);
        } catch (error) {
          errorCode = error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code : "DELIVERY_FAILED";
          permanent = error instanceof PermanentDeliveryError ||
            (error instanceof Error && "code" in error && error.code === "NON_RETRYABLE");
          if (permanent) errorCode = error instanceof Error && "reason" in error && typeof error.reason === "string"
            ? error.reason : "NON_RETRYABLE";
        }
        let changed: number;
        let outcome: string;
        if (!errorCode) {
          changed = await client.$executeRaw`
            UPDATE platform.outbox_message SET status = 'delivered', delivered_at = now(),
              lease_owner = NULL, lease_until = NULL
            WHERE id = ${message.id}::uuid AND status = 'leased' AND lease_owner = ${workerId}
              AND attempt_count = ${message.attemptCount}`;
          outcome = "delivered";
        } else {
          const dead = permanent || message.attemptCount >= maxAttempts;
          const delay = permanent ? 0 : Math.floor(Math.random() *
            Math.min(maxBackoffMs, baseBackoffMs * 2 ** (message.attemptCount - 1)));
          changed = await client.$executeRaw`
            UPDATE platform.outbox_message SET status = ${dead ? "dead_letter" : "retry_due"},
              next_attempt_at = now() + (${delay} * interval '1 millisecond'),
              last_error_code = ${errorCode}, lease_owner = NULL, lease_until = NULL
            WHERE id = ${message.id}::uuid AND status = 'leased' AND lease_owner = ${workerId}
              AND attempt_count = ${message.attemptCount}`;
          outcome = dead ? "dead_letter" : "retried";
        }
        if (changed === 0) outcome = "lease_lost";
        if (outcome === "delivered") result.delivered++;
        else if (outcome === "retried") result.retried++;
        else if (outcome === "dead_letter") result.deadLettered++;
        else result.leaseLost++;
        log(message, outcome);
      }
      return result;
    },
    async stats() {
      const rows = await client.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } });
      const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
      return { pending: count("pending"), leased: count("leased"), retryDue: count("retry_due"),
        deadLetter: count("dead_letter"), delivered: count("delivered") };
    },
  };
}

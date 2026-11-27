// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { safeHaltReason } from "./diagnostics";
const destinations = new Set(["workflow", "local", "traceability", "federation"]);
const states = ["requested", "starting", "pending", "decision_pending"];

export async function workMetrics(db: PrismaClient): Promise<string> {
  const [outbox, workflow, ages, federationQueue, attempts, inbox, receipts, scans, quality, aiDrafts] = await Promise.all([
    db.$queryRaw<{ destination: string; pending: bigint; retry: bigint; dead: bigint }[]>`
      SELECT destination, count(*) FILTER (WHERE status = 'pending') AS pending,
        count(*) FILTER (WHERE status = 'pending' AND attempt_count > 0) AS retry,
        count(*) FILTER (WHERE status = 'dead_letter') AS dead
      FROM platform.outbox_message GROUP BY destination`,
    db.$queryRaw<{ state: string; halt_reason: string | null; total: bigint }[]>`
      SELECT state::text, halt_reason, count(*) AS total FROM platform.approval_request
      WHERE state IN ('requested', 'starting', 'pending', 'decision_pending', 'halted')
      GROUP BY state, halt_reason`,
    db.$queryRaw<{ outbox_age: number; workflow_age: number }[]>`
      SELECT COALESCE((SELECT EXTRACT(EPOCH FROM now() - min(created_at))::float8
        FROM platform.outbox_message WHERE status IN ('pending', 'leased')), 0) AS outbox_age,
        COALESCE((SELECT EXTRACT(EPOCH FROM now() - min(created_at))::float8
        FROM platform.approval_request WHERE state IN ('requested', 'starting', 'pending', 'decision_pending')), 0) AS workflow_age`,
    db.$queryRaw<{ oldest_age: number; due: bigint }[]>`
      SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at))::float8, 0) AS oldest_age,
        count(*) FILTER (WHERE next_attempt_at <= now()) AS due
      FROM platform.outbox_message WHERE destination = 'federation'
        AND status IN ('pending', 'leased', 'retry_due')`,
    db.$queryRaw<{ result: string; total: bigint }[]>`
      SELECT result, count(*) AS total FROM federation.delivery_attempt GROUP BY result`,
    db.$queryRaw<{ state: string; total: bigint }[]>`
      SELECT state, count(*) AS total FROM federation.inbox_message GROUP BY state`,
    db.$queryRaw<{ delivery_state: string; total: bigint }[]>`
      SELECT td.delivery_state, count(*) AS total FROM trading.transfer_detail td
      JOIN trading.document d ON d.id = td.document_id WHERE d.status = 'confirmed'
      GROUP BY td.delivery_state`,
    db.$queryRaw<{ scan_state: string; total: bigint }[]>`
      SELECT scan_state, count(*) AS total FROM platform.attachment GROUP BY scan_state`,
    db.$queryRaw<{ state: string; total: bigint }[]>`
      SELECT state, count(*) AS total FROM traceability.quality_issue GROUP BY state`,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM platform.audit_log
      WHERE action LIKE 'ai.%' AND created_at > now() - interval '1 hour'`,
  ]);
  const lines: string[] = [];
  const counts = new Map<string, { pending: number; retry: number; dead: number }>();
  for (const row of outbox) {
    const destination = destinations.has(row.destination) ? row.destination : "other";
    const current = counts.get(destination) ?? { pending: 0, retry: 0, dead: 0 };
    current.pending += Number(row.pending);
    current.retry += Number(row.retry);
    current.dead += Number(row.dead);
    counts.set(destination, current);
  }
  for (const [destination, count] of counts) {
    lines.push(`outbox_pending{destination="${destination}"} ${count.pending}`,
      `outbox_retry{destination="${destination}"} ${count.retry}`,
      `outbox_dead{destination="${destination}"} ${count.dead}`);
  }
  const pending = new Map(states.map((state) => [state, 0]));
  const failed = new Map<string, number>();
  for (const row of workflow) {
    if (row.state === "halted") {
      const reason = safeHaltReason(row.halt_reason);
      failed.set(reason, (failed.get(reason) ?? 0) + Number(row.total));
    } else if (pending.has(row.state)) pending.set(row.state, pending.get(row.state)! + Number(row.total));
  }
  for (const [state, count] of pending) lines.push(`workflow_pending{state="${state}"} ${count}`);
  for (const [reason, count] of failed) lines.push(`workflow_failed{halt_reason="${reason}"} ${count}`);
  lines.push(`outbox_oldest_pending_age_seconds ${Math.max(0, ages[0].outbox_age)}`,
    `workflow_oldest_pending_age_seconds ${Math.max(0, ages[0].workflow_age)}`);
  lines.push(`federation_queue_oldest_age_seconds ${Math.max(0, federationQueue[0].oldest_age)}`,
    `federation_queue_due ${Number(federationQueue[0].due)}`);
  for (const result of ["ack", "retry", "permanent_failure"])
    lines.push(`federation_delivery_attempts{result="${result}"} ${Number(attempts.find((row) => row.result === result)?.total ?? 0)}`);
  for (const state of ["validated", "pending_dependency", "applied_to_trace", "rejected"])
    lines.push(`federation_inbox{state="${state}"} ${Number(inbox.find((row) => row.state === state)?.total ?? 0)}`);
  for (const state of ["pending", "technical_ack", "received", "partial", "disputed"])
    lines.push(`federation_business_receipt{state="${state}"} ${Number(receipts.find((row) => row.delivery_state === state)?.total ?? 0)}`);
  for (const state of ["pending", "clean", "infected", "error"])
    lines.push(`attachment_scan{state="${state}"} ${Number(scans.find((row) => row.scan_state === state)?.total ?? 0)}`);
  for (const state of ["open", "acknowledged", "resolved"])
    lines.push(`quality_issue{state="${state}"} ${Number(quality.find((row) => row.state === state)?.total ?? 0)}`);
  lines.push(`ai_audit_events_1h ${Number(aiDrafts[0]?.total ?? 0)}`);
  return `${lines.join("\n")}\n`;
}

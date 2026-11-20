// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { safeHaltReason } from "./diagnostics";

const destinations = new Set(["workflow", "local", "traceability", "federation"]);
const states = ["requested", "starting", "pending", "decision_pending"];

export async function workMetrics(db: PrismaClient): Promise<string> {
  const [outbox, workflow, ages] = await Promise.all([
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
  return lines.join("\n") + "\n";
}

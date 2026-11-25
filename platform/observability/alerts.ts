// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { safeErrorCode, safeHaltReason } from "./diagnostics";

export const ALERT_THRESHOLDS = { startingSeconds: 300, decisionSeconds: 900,
  outboxSeconds: 900, federationInboxSeconds: 900, federationReceiptSeconds: 3600 } as const;
type Alert = {
  event: "ops.alert.stuck";
  kind: "outbox_dead" | "workflow_halted" | "workflow_starting_stuck" | "workflow_decision_stuck" |
    "outbox_oldest_pending" | "federation_queue_stuck" | "federation_inbox_pending" |
    "federation_inbox_rejected" | "federation_receipt_pending";
  messageId?: string;
  approvalRequestId?: string;
  processId?: string;
  transferId?: string;
  state: string;
  ageSeconds: number;
  errorCode?: string | null;
  haltReason?: string;
};
type Logger = (line: Record<string, unknown>) => void;

export async function scanStuckWork(db: PrismaClient, logger: Logger = (line) => console.log(JSON.stringify(line)),
  thresholds = ALERT_THRESHOLDS): Promise<Alert[]> {
  const [dead, approvals, oldest, federationOldest, inbox, receipts] = await Promise.all([
    db.outboxMessage.findMany({ where: { status: "dead_letter" }, select: { id: true, status: true, createdAt: true, lastErrorCode: true } }),
    db.approvalRequest.findMany({ where: { state: { in: ["halted", "starting", "decision_pending"] } },
      select: { id: true, state: true, createdAt: true, flowableProcessId: true, haltReason: true } }),
    db.outboxMessage.findFirst({ where: { status: { in: ["pending", "leased"] } }, orderBy: { createdAt: "asc" },
      select: { id: true, status: true, createdAt: true } }),
    db.outboxMessage.findFirst({ where: { destination: "federation",
      status: { in: ["pending", "leased", "retry_due"] } }, orderBy: { createdAt: "asc" },
    select: { id: true, status: true, createdAt: true } }),
    db.inboxMessage.findMany({ where: { state: { in: ["pending_dependency", "rejected"] } },
      orderBy: { receivedAt: "asc" }, take: 100,
      select: { messageId: true, state: true, receivedAt: true, errorCode: true } }),
    db.transferDetail.findMany({ where: { deliveryState: { in: ["pending", "technical_ack", "disputed"] },
      document: { status: "confirmed" } }, take: 100,
      select: { documentId: true, deliveryState: true, document: { select: { createdAt: true } } } }),
  ]);
  const age = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const alerts: Alert[] = [];
  for (const row of dead) alerts.push({ event: "ops.alert.stuck", kind: "outbox_dead",
    messageId: row.id, state: row.status, ageSeconds: age(row.createdAt), errorCode: safeErrorCode(row.lastErrorCode) });
  for (const row of approvals) {
    const seconds = age(row.createdAt);
    const kind = row.state === "halted" ? "workflow_halted" :
      row.state === "starting" && seconds > thresholds.startingSeconds ? "workflow_starting_stuck" :
        row.state === "decision_pending" && seconds > thresholds.decisionSeconds ? "workflow_decision_stuck" : null;
    if (kind) alerts.push({ event: "ops.alert.stuck", kind, approvalRequestId: row.id,
      ...(row.flowableProcessId && /^[A-Za-z0-9._:-]{1,128}$/.test(row.flowableProcessId) ? { processId: row.flowableProcessId } : {}),
      state: row.state, ageSeconds: seconds,
      ...(row.state === "halted" ? { haltReason: safeHaltReason(row.haltReason) } : {}) });
  }
  if (oldest && age(oldest.createdAt) > thresholds.outboxSeconds) alerts.push({ event: "ops.alert.stuck",
    kind: "outbox_oldest_pending", messageId: oldest.id, state: oldest.status, ageSeconds: age(oldest.createdAt) });
  if (federationOldest && age(federationOldest.createdAt) > thresholds.outboxSeconds)
    alerts.push({ event: "ops.alert.stuck", kind: "federation_queue_stuck",
      messageId: federationOldest.id, state: federationOldest.status,
      ageSeconds: age(federationOldest.createdAt) });
  for (const row of inbox) {
    const seconds = age(row.receivedAt);
    if (row.state === "rejected" || seconds > thresholds.federationInboxSeconds)
      alerts.push({ event: "ops.alert.stuck", kind: row.state === "rejected" ?
        "federation_inbox_rejected" : "federation_inbox_pending", messageId: row.messageId,
      state: row.state, ageSeconds: seconds, errorCode: safeErrorCode(row.errorCode) });
  }
  for (const row of receipts) {
    const seconds = age(row.document.createdAt);
    if (row.deliveryState === "disputed" || seconds > thresholds.federationReceiptSeconds)
      alerts.push({ event: "ops.alert.stuck", kind: "federation_receipt_pending",
        transferId: row.documentId, state: row.deliveryState, ageSeconds: seconds });
  }
  for (const alert of alerts) logger(alert);
  logger({ event: "ops.scan.completed", incidentCount: alerts.length });
  return alerts;
}

// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { serializeDomainEvent, WORKFLOW_EVENT_TYPES } from "../../contracts/events/registry";
import { appendOutbox } from "../outbox/writer";
import { auditApproval, getApproval, transition } from "./approval-repository";
import { ApprovalNotReadyError, ApprovalScopeError, DecisionConflictError, SelfApprovalError,
  SnapshotMismatchError, VersionConflictError, hasScope, type ActorResolver, type Decision } from "./approval-request";

export async function createRequest(tx: Prisma.TransactionClient, input: {
  documentId: string; submittedDocumentVersion: number; creatorSub: string;
  warehouseIds: string[]; lineSnapshotSha256: string;
}) {
  if (!/^[0-9a-f]{64}$/.test(input.lineSnapshotSha256) || !input.creatorSub.trim() ||
    !Number.isInteger(input.submittedDocumentVersion) || input.submittedDocumentVersion < 1 ||
    !input.warehouseIds.length || input.warehouseIds.some((id) => !id)) throw new Error("Invalid approval request");
  const existing = await tx.approvalRequest.findUnique({ where: { documentId: input.documentId } });
  if (existing) {
    if (existing.lineSnapshotSha256 === input.lineSnapshotSha256 &&
      existing.submittedDocumentVersion === input.submittedDocumentVersion &&
      existing.creatorSub === input.creatorSub &&
      JSON.stringify(existing.warehouseIds) === JSON.stringify(input.warehouseIds)) return existing;
    throw new DecisionConflictError("Document already has a different approval request");
  }
  const row = await tx.approvalRequest.create({ data: { id: randomUUID(), ...input } });
  await auditApproval(tx, row, "workflow.approval.requested", input.creatorSub);
  await appendOutbox(tx, serializeDomainEvent({ type: WORKFLOW_EVENT_TYPES.requested, aggregateType: "approval_request",
    aggregateId: row.id, aggregateVersion: row.version, correlationId: row.id, payload: {
      eventId: randomUUID(), approvalRequestId: row.id, documentId: row.documentId, creatorSub: row.creatorSub,
      processKey: "goods-issue-approval", correlationKey: row.id,
      submittedDocumentVersion: row.submittedDocumentVersion, lineSnapshotSha256: row.lineSnapshotSha256,
    } }));
  return row;
}

export { getApproval };

export async function recordDecisionIntent(tx: Prisma.TransactionClient, resolver: ActorResolver, input: {
  approvalRequestId: string; actorSub: string; decision: Decision; reason?: string;
  flowableTaskId: string; expectedVersion: number;
}) {
  const actor = await resolver(input.actorSub);
  if (!actor?.active || actor.role !== "approver") throw new ApprovalScopeError("Approver membership inactive or missing");
  const row = await getApproval(tx, input.approvalRequestId);
  if (!row) throw new ApprovalNotReadyError("Approval request missing");
  if (actor.sub === row.creatorSub) throw new SelfApprovalError("Creator cannot approve own request");
  if (!hasScope(actor, row.warehouseIds, "approver")) throw new ApprovalScopeError("Warehouse scope incomplete");
  if (row.state === "decision_pending") {
    if (row.decisionRequestedBySub === actor.sub && row.decisionIntent === input.decision &&
        row.flowableTaskId === input.flowableTaskId && row.decisionIntentReason === (input.reason?.trim() || null)) return row;
    throw new DecisionConflictError("Another decision is pending");
  }
  if (row.state !== "pending") throw new ApprovalNotReadyError("Approval not pending");
  if (row.version !== input.expectedVersion) throw new VersionConflictError("Approval version changed");
  if (!["approved", "rejected"].includes(input.decision) || !input.flowableTaskId ||
      (input.decision === "rejected" && !input.reason?.trim())) throw new Error("Invalid approval decision");
  const changed = await transition(tx, row.id, ["pending"], "decision_pending", {
    decisionIntent: input.decision, decisionIntentReason: input.reason?.trim() || null,
    decisionRequestedBySub: actor.sub, decisionRequestedAt: new Date(), flowableTaskId: input.flowableTaskId,
  }, row.version);
  if (!changed) throw new VersionConflictError("Approval version changed");
  await auditApproval(tx, changed, "workflow.decision.intent_recorded", actor.sub, row.state);
  await appendOutbox(tx, serializeDomainEvent({ type: WORKFLOW_EVENT_TYPES.decisionRequested,
    aggregateType: "approval_request", aggregateId: row.id, aggregateVersion: changed.version,
    correlationId: row.id, payload: {
      eventId: randomUUID(), approvalRequestId: row.id, documentId: row.documentId,
      taskId: input.flowableTaskId, decision: input.decision, ...(input.reason?.trim() && { decisionReason: input.reason.trim() }),
      requestedBySub: actor.sub, requestedAt: changed.decisionRequestedAt!.toISOString(),
      lineSnapshotSha256: row.lineSnapshotSha256, intentVersion: changed.version,
    } }));
  return changed;
}

export async function cancelRequest(tx: Prisma.TransactionClient, input: {
  approvalRequestId: string; actorSub: string; reason: string;
}) {
  if (!input.reason.trim()) throw new Error("Cancellation reason required");
  const row = await getApproval(tx, input.approvalRequestId);
  if (!row) throw new ApprovalNotReadyError("Approval request missing");
  const changed = await transition(tx, row.id, ["requested", "starting", "pending", "decision_pending"],
    "cancelled", { cancelReason: input.reason.trim() }, row.version);
  if (!changed) throw new VersionConflictError("Approval version changed");
  await auditApproval(tx, changed, "workflow.approval.cancelled", input.actorSub, row.state);
  return changed;
}

export async function cancelApprovedRequest(tx: Prisma.TransactionClient, input: {
  approvalRequestId: string; actorSub: string; reason: string;
}) {
  if (!input.reason.trim()) throw new Error("Cancellation reason required");
  const row = await getApproval(tx, input.approvalRequestId);
  if (!row || row.state !== "approved") throw new ApprovalNotReadyError("Approval not approved");
  const changed = await transition(tx, row.id, ["approved"], "cancelled",
    { cancelReason: input.reason.trim(), engineCleanupAt: new Date() }, row.version);
  if (!changed) throw new VersionConflictError("Approval version changed");
  await auditApproval(tx, changed, "workflow.approval.cancelled", input.actorSub, row.state);
  return changed;
}

export async function confirmApproval(tx: Prisma.TransactionClient, resolver: ActorResolver,
  reconcile: (id: string) => Promise<void>, input: {
    approvalRequestId: string; actorSub: string; currentLineSnapshotSha256: string;
  }) {
  await reconcile(input.approvalRequestId);
  await tx.$queryRaw`SELECT id FROM platform.approval_request WHERE id = ${input.approvalRequestId}::uuid FOR UPDATE`;
  const row = await getApproval(tx, input.approvalRequestId);
  if (!row) throw new ApprovalNotReadyError("Approval request missing");
  const actor = await resolver(input.actorSub);
  if (!hasScope(actor, row.warehouseIds)) throw new ApprovalScopeError("Current warehouse scope incomplete");
  if (row.state !== "approved" || row.haltReason) throw new ApprovalNotReadyError("Approval not approved");
  if (row.lineSnapshotSha256 !== input.currentLineSnapshotSha256)
    throw new SnapshotMismatchError("Approved line snapshot changed");
  const changed = await transition(tx, row.id, ["approved"], "confirmed", {
    confirmedBySub: input.actorSub, confirmedAt: new Date(),
  }, row.version);
  if (!changed) throw new VersionConflictError("Approval version changed");
  await auditApproval(tx, changed, "workflow.approval.confirmed", input.actorSub, row.state);
  return changed;
}

// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { serializeDomainEvent, WORKFLOW_EVENT_TYPES } from "../../contracts/events/registry";
import { appendOutbox } from "../outbox/writer";
import { auditApproval, getApproval } from "./approval-repository";
import { DecisionConflictError } from "./approval-request";

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

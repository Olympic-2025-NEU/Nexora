// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { FlowableClient } from "@/platform/workflow/flowable-client";
import {
  hasScope,
  ISSUE_APPROVER_ROLE,
  type Decision,
} from "@/platform/workflow/approval-request";
import { recordDecisionIntent } from "@/platform/workflow/approval-service";
import { DomainError } from "@/platform/kernel/errors";
import { membershipRepository } from "@/composition/system";

export async function approvalInbox(actor: Actor) {
  if (!actor.roles.includes(ISSUE_APPROVER_ROLE)) return [];
  const engine = FlowableClient.fromEnv();
  const tasks = await engine.queryTasks({ candidateGroup: ISSUE_APPROVER_ROLE });
  const db = getPrismaClient();
  const rows = await db.approvalRequest.findMany({
    where: {
      state: "pending",
      flowableTaskId: {
        in: tasks
          .filter((task) => task.taskDefinitionKey === "approveGoodsIssue")
          .map((task) => task.id),
      },
    },
    include: { document: true },
    take: 200,
  });
  const documentIds = rows.map((row) => row.documentId);
  const evidenceRows = documentIds.length
    ? await db.traceEvidence.findMany({
      where: { documentId: { in: documentIds }, state: "active" },
      select: { documentId: true, attachmentId: true },
      take: 1000,
    })
    : [];
  const evidenceByDocument = new Map<string, string[]>();
  for (const evidence of evidenceRows) {
    const list = evidenceByDocument.get(evidence.documentId) ?? [];
    list.push(evidence.attachmentId);
    evidenceByDocument.set(evidence.documentId, list);
  }
  const now = Date.now();
  return rows
    .filter((row) =>
      row.creatorSub !== actor.userId &&
      row.document.status === "pending_approval" &&
      hasScope(
        {
          sub: actor.userId,
          roles: [...actor.roles],
          active: true,
          warehouseIds: [...actor.unitIds],
        },
        row.warehouseIds,
        ISSUE_APPROVER_ROLE,
      ) &&
      tasks.some((task) =>
        task.id === row.flowableTaskId &&
        task.processInstanceId === row.flowableProcessId &&
        task.processDefinitionId === row.flowableDefinitionId))
    .map((row) => ({
      approvalRequestId: row.id,
      documentId: row.documentId,
      documentNumber: row.document.documentNumber,
      documentType: row.document.documentType,
      creatorSub: row.creatorSub,
      submittedAt: row.createdAt.toISOString(),
      ageSeconds: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 1000)),
      warehouseIds: row.warehouseIds,
      lineHash: row.lineSnapshotSha256,
      approvalState: row.state,
      processDefinitionVersion: row.flowableDefinitionVersion,
      approvalVersion: row.version,
      evidenceFileIds: evidenceByDocument.get(row.documentId) ?? [],
    }));
}

export async function decideApproval(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  decision: Decision,
  note: string | undefined,
  expectedVersion: number,
) {
  const row = await tx.approvalRequest.findUnique({ where: { id }, include: { document: true } });
  if (!row) throw new DomainError("APPROVAL_NOT_FOUND", 404);
  if (
    !Array.isArray(row.warehouseIds) ||
    row.warehouseIds.some((warehouseId) => !actor.unitIds.includes(String(warehouseId)))
  ) {
    throw new DomainError("APPROVAL_SCOPE", 403);
  }
  if (row.document.status !== "pending_approval" || row.state !== "pending" || !row.flowableTaskId) {
    throw new DomainError("APPROVAL_NOT_READY", 409);
  }
  if (row.version !== expectedVersion) throw new DomainError("VERSION_CONFLICT", 409);
  const membership = membershipRepository();
  await recordDecisionIntent(
    tx,
    async (sub) => {
      const current = await membership.findBySub(sub);
      return current
        ? {
          sub,
          active: current.status === "active",
          roles: current.roles?.length ? [...current.roles] : [current.role],
          warehouseIds: current.warehouseIds,
        }
        : null;
    },
    {
      approvalRequestId: id,
      actorSub: actor.userId,
      decision,
      reason: note,
      flowableTaskId: row.flowableTaskId,
      expectedVersion,
    },
  );
  return {
    approvalRequestId: id,
    state: "decision_pending" as const,
    decision: decision === "approved" ? "approve" : "reject",
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
import { Prisma, type ApprovalRequest, type ApprovalRequestState, type PrismaClient } from "@prisma/client";

export type ApprovalDb = Prisma.TransactionClient | PrismaClient;
export const getApproval = (db: ApprovalDb, id: string) => db.approvalRequest.findUnique({ where: { id } });

export async function transition(db: ApprovalDb, id: string, from: ApprovalRequestState[], to: ApprovalRequestState,
  patch: Prisma.ApprovalRequestUpdateManyMutationInput, expectedVersion: number): Promise<ApprovalRequest | null> {
  const result = await db.approvalRequest.updateMany({ where: { id, version: expectedVersion, state: { in: from } },
    data: { ...patch, state: to, version: { increment: 1 }, updatedAt: new Date() } });
  return result.count === 1 ? getApproval(db, id) : null;
}

export async function auditApproval(db: ApprovalDb, row: ApprovalRequest, action: string,
  actorSub: string | null = null, before?: string): Promise<void> {
  await db.auditLog.create({ data: { id: crypto.randomUUID(), actorSub, clientId: actorSub ? null : "workflow-worker",
    action, targetType: "approval_request", targetId: row.id, outcome: "success", requestId: row.id,
    beforeSummary: before ? { status: before } : {}, afterSummary: { status: row.state, version: row.version } } });
}

export function transitionAudited(db: PrismaClient, id: string, from: ApprovalRequestState[],
  to: ApprovalRequestState, patch: Prisma.ApprovalRequestUpdateManyMutationInput,
  version: number, action: string, before?: string) {
  return db.$transaction(async (tx) => {
    const changed = await transition(tx, id, from, to, patch, version);
    if (changed) await auditApproval(tx, changed, action, null, before);
    return changed;
  });
}

export async function withApprovalLock<T>(client: PrismaClient, id: string, work: () => Promise<T>): Promise<T | undefined> {
  const connection = await client.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS locked`;
    if (!locked) return { locked: false as const };
    return { locked: true as const, result: await work() };
  }, { timeout: 120000 });
  return connection.locked ? connection.result : undefined;
}

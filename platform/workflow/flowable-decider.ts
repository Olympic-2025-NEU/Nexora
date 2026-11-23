// SPDX-License-Identifier: AGPL-3.0-only
import type { ApprovalRequest, PrismaClient } from "@prisma/client";
import type { OutboxMessage } from "../outbox/message";
import { getApproval, transitionAudited, withApprovalLock } from "./approval-repository";
import { hasScope, type ActorResolver, type Decision } from "./approval-request";
import { FlowableClient, FlowableHttpError, type History } from "./flowable-client";
import { haltApproval } from "./flowable-starter";

export function historyDecision(history: History, row: ApprovalRequest): "match" | "conflict" | "wait" {
  if (!history.endTime) return "wait";
  const variables = Object.fromEntries(history.variables.map(({ name, value }) => [name, value]));
  return row.decisionIntent === variables.decision && row.decisionRequestedBySub === variables.approverSub &&
    row.decisionRequestedAt?.toISOString() === variables.decidedAt &&
    (row.decisionIntent !== "rejected" || row.decisionIntentReason === variables.decisionReason)
    ? "match" : "conflict";
}

export async function readHistory(engine: FlowableClient, processId: string): Promise<History | null> {
  try { return await engine.getHistory(processId); }
  catch (error) { if (error instanceof FlowableHttpError && error.status === 404) return null; throw error; }
}

export function createFlowableDecider(db: PrismaClient, engine: FlowableClient, resolveActor: ActorResolver) {
  return async (message: OutboxMessage) => {
    const payload = message.payload as { approvalRequestId: string; intentVersion: number; taskId: string;
      lineSnapshotSha256: string; decision: Decision; requestedAt: string };
    const locked = await withApprovalLock(db, payload.approvalRequestId, async () => {
      const row = await getApproval(db, payload.approvalRequestId);
      if (!row || row.state !== "decision_pending" || row.version !== payload.intentVersion) return true;
      if (!row.flowableProcessId || !row.flowableDefinitionId || !row.flowableTaskId || !row.decisionIntent ||
          !row.decisionRequestedAt || !row.decisionRequestedBySub ||
          row.flowableTaskId !== payload.taskId || row.decisionIntent !== payload.decision ||
          row.decisionRequestedAt.toISOString() !== payload.requestedAt ||
          row.lineSnapshotSha256 !== payload.lineSnapshotSha256) {
        await haltApproval(db, row, "BINDING_MISMATCH"); return true;
      }
      const processes = await engine.findInstances(row.id);
      if (processes.length > 1) { await haltApproval(db, row, "DUPLICATE_PROCESS"); return true; }
      if (!processes.length || processes[0].id !== row.flowableProcessId ||
          processes[0].processDefinitionId !== row.flowableDefinitionId) {
        await haltApproval(db, row, "BINDING_MISMATCH"); return true;
      }
      let task;
      try { task = await engine.getTask(row.flowableTaskId); }
      catch (error) { if (!(error instanceof FlowableHttpError && error.status === 404)) throw error; }
      const history = await readHistory(engine, row.flowableProcessId);
      if (!task) {
        if (!history || historyDecision(history, row) === "wait") throw new Error("Decision history not available yet");
        if (historyDecision(history, row) === "conflict") await haltApproval(db, row, "DECISION_CONFLICT");
        return true;
      }
      if (task.processInstanceId !== row.flowableProcessId || task.taskDefinitionKey !== "approveGoodsIssue" ||
          task.processDefinitionId !== row.flowableDefinitionId) {
        await haltApproval(db, row, "BINDING_MISMATCH"); return true;
      }
      if (history?.endTime) {
        await haltApproval(db, row, "DECISION_CONFLICT"); return true;
      }
      const actor = await resolveActor(row.decisionRequestedBySub);
      if (!hasScope(actor, row.warehouseIds, "approver") || actor?.sub === row.creatorSub) {
        await transitionAudited(db, row.id, ["decision_pending"], "pending", {
          decisionIntent: null, decisionIntentReason: null, decisionRequestedBySub: null,
          decisionRequestedAt: null, flowableTaskId: null,
        }, row.version, "workflow.decision.revoked", row.state);
        return true;
      }
      await engine.completeTask(row.flowableTaskId, { decision: row.decisionIntent as Decision,
        ...(row.decisionIntentReason && { decisionReason: row.decisionIntentReason }),
        approverSub: row.decisionRequestedBySub, decidedAt: row.decisionRequestedAt.toISOString() });
      console.log(JSON.stringify({ event: "workflow.decision.dispatched", approvalRequestId: row.id,
        businessKey: row.id, processInstanceId: row.flowableProcessId }));
      return true;
    });
    if (!locked) throw new Error("Approval lock busy; retry delivery");
  };
}

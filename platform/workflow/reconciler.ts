// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma, PrismaClient, ApprovalRequest } from "@prisma/client";
import { auditApproval, getApproval, transition, transitionAudited, withApprovalLock } from "./approval-repository";
import { historyDecision, readHistory } from "./flowable-decider";
import { FlowableClient, FlowableHttpError } from "./flowable-client";
import { findBoundProcess, haltApproval } from "./flowable-starter";

export type ApprovalResultPort = (tx: Prisma.TransactionClient, documentId: string,
  result: "approved" | "rejected") => Promise<string | null>;

async function auditAnomaly(db: PrismaClient, row: ApprovalRequest, result: string, current: string) {
  await db.$transaction(async (tx) => {
    const existing = await tx.auditLog.findFirst({ where: { targetId: row.id,
      action: "workflow.approval.late_result_ignored" } });
    if (existing) return;
    await tx.auditLog.create({ data: { id: crypto.randomUUID(), clientId: "workflow-worker",
      actorSub: null, requestId: row.id, targetType: "approval_request", targetId: row.id,
      action: "workflow.approval.late_result_ignored", outcome: "success",
      beforeSummary: { status: current }, afterSummary: { result, observedAt: new Date().toISOString() } } });
  });
}

export async function reconcileApproval(db: PrismaClient, engine: FlowableClient, id: string,
  applyResult?: ApprovalResultPort): Promise<void> {
  await withApprovalLock(db, id, async () => {
    const row = await getApproval(db, id);
    if (!row) return;
    if (["approved", "rejected", "confirmed", "cancelled"].includes(row.state) && row.flowableProcessId) {
      const terminal = await readHistory(engine, row.flowableProcessId);
      if (terminal?.endTime && terminal.variables.some((variable) => variable.name === "decision") &&
        (row.state === "cancelled" || historyDecision(terminal, row) !== "match")) {
        const decision = terminal.variables.find((variable) => variable.name === "decision")?.value;
        await auditAnomaly(db, row, String(decision), row.state);
      }
    }
    if (row.state === "cancelled" && !row.engineCleanupAt) {
      const instances = await engine.findInstances(id);
      for (const instance of instances) {
        try {
          await engine.getInstance(instance.id);
          await engine.cancelProcess(instance.id, row.cancelReason ?? "Approval cancelled");
        } catch (error) { if (!(error instanceof FlowableHttpError && error.status === 404)) throw error; }
      }
      await transitionAudited(db, id, ["cancelled"], "cancelled", { engineCleanupAt: new Date() },
        row.version, "workflow.approval.engine_cleanup");
      return;
    }
    if (row.state === "starting" && !row.flowableProcessId && Date.now() - row.updatedAt.getTime() > 30000) {
      const bound = await findBoundProcess(engine, row);
      if (!bound) return;
      if ("halt" in bound) return haltApproval(db, row, bound.halt);
      await transitionAudited(db, id, ["starting"], "pending", {
        flowableProcessId: bound.instance.id, flowableDefinitionId: bound.instance.processDefinitionId,
        flowableDefinitionVersion: bound.definitionVersion,
      }, row.version, "workflow.start.adopted");
      return;
    }
    if (!["pending", "decision_pending"].includes(row.state) || !row.flowableProcessId) return;
    const instances = await engine.findInstances(row.id);
    if (instances.length > 1) return haltApproval(db, row, "DUPLICATE_PROCESS");
    if (instances.length && (instances[0].id !== row.flowableProcessId ||
        instances[0].processDefinitionId !== row.flowableDefinitionId)) return haltApproval(db, row, "BINDING_MISMATCH");
    let history = await readHistory(engine, row.flowableProcessId);
    if (!instances.length && !history) return haltApproval(db, row, "PROCESS_VANISHED");
    if (row.state === "pending") {
      if (history?.endTime) {
        const variables = Object.fromEntries(history.variables.map(({ name, value }) => [name, value]));
        return haltApproval(db, row, variables.decision ? "EXTERNAL_COMPLETION" : "HISTORY_WITHOUT_DECISION");
      }
      if (!row.flowableTaskId) {
        const tasks = await engine.queryTasks({ processInstanceId: row.flowableProcessId });
        const task = tasks.find((candidate) => candidate.taskDefinitionKey === "approveGoodsIssue");
        if (task) {
          await transitionAudited(db, id, ["pending"], "pending", { flowableTaskId: task.id },
            row.version, "workflow.task.discovered");
        }
      }
      return;
    }
    if (Date.now() - (row.decisionRequestedAt?.getTime() ?? Date.now()) > 900000)
      console.log(JSON.stringify({ event: "DECISION_STUCK", approvalRequestId: id, businessKey: id,
        processInstanceId: row.flowableProcessId }));
    if (!row.flowableTaskId) return haltApproval(db, row, "BINDING_MISMATCH");
    let task;
    try { task = await engine.getTask(row.flowableTaskId); }
    catch (error) {
      if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
    }
    if (task) return;
    history ??= await readHistory(engine, row.flowableProcessId);
    if (!history?.endTime) return;
    if (historyDecision(history, row) !== "match") {
      const result = history.variables.find((variable) => variable.name === "decision")?.value;
      await auditAnomaly(db, row, String(result), row.state);
      return haltApproval(db, row, "DECISION_CONFLICT");
    }
    const variables = Object.fromEntries(history.variables.map(({ name, value }) => [name, value]));
    const decision = row.decisionIntent as "approved" | "rejected";
    const completedAt = new Date(history.endTime);
    const changed = await db.$transaction(async (tx) => {
      if (applyResult) {
        const status = await applyResult(tx, row.documentId, decision);
        if (status !== decision) {
          const existing = await tx.auditLog.findFirst({ where: { targetId: row.id,
            action: "workflow.approval.late_result_ignored" } });
          if (!existing) await tx.auditLog.create({ data: { id: crypto.randomUUID(), clientId: "workflow-worker",
            actorSub: null, requestId: row.id, targetType: "approval_request", targetId: row.id,
            action: "workflow.approval.late_result_ignored", outcome: "success",
            beforeSummary: { status: status ?? "missing" }, afterSummary: { result: decision,
              observedAt: new Date().toISOString() } } });
          return null;
        }
      }
      const updated = await transition(tx, id, ["decision_pending"], decision, {
        decision, decisionReason: typeof variables.decisionReason === "string" ? variables.decisionReason : null,
        approverSub: row.decisionRequestedBySub, decidedAt: row.decisionRequestedAt,
        engineCompletedAt: completedAt,
      }, row.version);
      if (updated) await auditApproval(tx, updated, "workflow.reconcile.synced", null, row.state);
      return updated;
    });
    if (changed) {
      console.log(JSON.stringify({ event: "workflow.reconcile.synced", approvalRequestId: id, businessKey: id,
        processInstanceId: row.flowableProcessId, decision, decisionLatencyMs: 0 }));
    }
  });
}

export function createReconciler(db: PrismaClient, engine: FlowableClient, applyResult?: ApprovalResultPort) {
  return {
    async tick() {
      const rows = await db.approvalRequest.findMany({ where: {
        OR: [{ state: { in: ["starting", "pending", "decision_pending", "approved", "rejected"] } },
          { state: "cancelled", engineCleanupAt: null }],
      }, orderBy: { updatedAt: "asc" }, take: 50 });
      for (const row of rows) {
        try { await reconcileApproval(db, engine, row.id, applyResult); }
        catch (error) { console.error(JSON.stringify({ event: "workflow.engine.unreachable", approvalRequestId: row.id,
          businessKey: row.id, processInstanceId: row.flowableProcessId, error: String(error) })); }
      }
      try {
        const instances = await engine.listRuntimeInstances();
        for (const instance of instances) {
          const row = await db.approvalRequest.findUnique({ where: { id: instance.businessKey } });
          if (!row || ["approved", "rejected", "confirmed", "halted"].includes(row.state))
            console.log(JSON.stringify({ event: row ? "workflow.reconcile.diverged" : "workflow.reconcile.orphan_engine_process",
              approvalRequestId: instance.businessKey, businessKey: instance.businessKey,
              processInstanceId: instance.id }));
        }
      } catch (error) { console.error(JSON.stringify({ event: "workflow.engine.unreachable", error: String(error) })); }
    },
  };
}

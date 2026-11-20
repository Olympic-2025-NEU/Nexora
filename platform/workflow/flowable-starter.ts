// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient, ApprovalRequest } from "@prisma/client";
import type { OutboxMessage } from "../outbox/message";
import { PermanentDeliveryError } from "../outbox/message";
import { auditApproval, getApproval, transition, withApprovalLock } from "./approval-repository";
import { FlowableClient, FlowableHttpError, PROCESS_KEY, type ProcessInstance } from "./flowable-client";

export async function findBoundProcess(client: FlowableClient, row: ApprovalRequest): Promise<
  { instance: ProcessInstance; definitionVersion: number } | { halt: "DUPLICATE_PROCESS" | "BINDING_MISMATCH" } | null> {
  const instances = await client.findInstances(row.id);
  if (instances.length > 1) return { halt: "DUPLICATE_PROCESS" };
  if (!instances.length) return null;
  const instance = instances[0];
  const [definition, history] = await Promise.all([client.getDefinition(instance.processDefinitionId), client.getHistory(instance.id)]);
  const variables = Object.fromEntries(history.variables.map(({ name, value }) => [name, value]));
  if (definition.key !== PROCESS_KEY || instance.businessKey !== row.id ||
      variables.approvalRequestId !== row.id || variables.documentId !== row.documentId ||
      (row.flowableProcessId && row.flowableProcessId !== instance.id)) return { halt: "BINDING_MISMATCH" };
  return { instance, definitionVersion: definition.version };
}

export async function haltApproval(db: PrismaClient, row: ApprovalRequest, reason: string): Promise<void> {
  const changed = await transition(db, row.id, ["requested", "starting", "pending", "decision_pending"],
    "halted", { haltReason: reason }, row.version);
  if (changed) {
    await auditApproval(db, changed, `workflow.approval.halted.${reason}`);
    console.log(JSON.stringify({ event: "workflow.reconcile.diverged", approvalRequestId: row.id,
      businessKey: row.id, processInstanceId: row.flowableProcessId, reason }));
  }
}

export function createFlowableStarter(db: PrismaClient, engine: FlowableClient) {
  return async (message: OutboxMessage) => {
    const id = (message.payload as { approvalRequestId: string }).approvalRequestId;
    let row = await getApproval(db, id);
    if (!row || ["cancelled", "halted", "confirmed", "rejected", "approved"].includes(row.state) ||
      (row.state === "pending" && row.flowableProcessId)) return;
    if (row.state === "requested") row = await transition(db, id, ["requested"], "starting", {}, row.version);
    if (!row) return;
    await withApprovalLock(db, id, async () => {
      const current = await getApproval(db, id);
      if (!current || current.state !== "starting") return;
      const valid = /^[0-9a-f]{64}$/.test(current.lineSnapshotSha256) &&
        /^[0-9a-f-]{36}$/i.test(current.id) && /^[0-9a-f-]{36}$/i.test(current.documentId) &&
        current.creatorSub.trim() && current.submittedDocumentVersion > 0 &&
        Array.isArray(current.warehouseIds) && current.warehouseIds.length > 0 &&
        current.warehouseIds.every((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value));
      if (!valid) {
        await haltApproval(db, current, "INVALID_START_VARIABLES");
        throw new PermanentDeliveryError("INVALID_START_VARIABLES");
      }
      let bound = await findBoundProcess(engine, current);
      if (bound && "halt" in bound) { await haltApproval(db, current, bound.halt); return; }
      if (!bound) {
        try {
          const instance = await engine.startProcess({ businessKey: id, variables: {
            approvalRequestId: id, documentId: current.documentId, creatorSub: current.creatorSub,
            warehouseIds: current.warehouseIds as string[], submittedAt: current.createdAt.toISOString(),
            submittedDocumentVersion: current.submittedDocumentVersion, lineSnapshotSha256: current.lineSnapshotSha256,
          } });
          const definition = await engine.getDefinition(instance.processDefinitionId);
          bound = { instance, definitionVersion: definition.version };
        } catch (error) {
          if (error instanceof FlowableHttpError && error.status === 400 &&
              !/process definition.*not found|no process definition/i.test(error.detail)) {
            await haltApproval(db, current, "ENGINE_REJECTED_START");
            throw new PermanentDeliveryError("ENGINE_REJECTED_START", error.message);
          }
          throw error;
        }
      }
      const changed = await transition(db, id, ["starting"], "pending", {
        flowableProcessId: bound.instance.id, flowableDefinitionId: bound.instance.processDefinitionId,
        flowableDefinitionVersion: bound.definitionVersion,
      }, current.version);
      if (changed) {
        await auditApproval(db, changed, "workflow.start.created");
        console.log(JSON.stringify({ event: "workflow.start.created", approvalRequestId: id, businessKey: id,
          processInstanceId: bound.instance.id }));
      }
    });
  };
}

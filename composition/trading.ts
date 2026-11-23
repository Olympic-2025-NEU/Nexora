// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import { adjustStock } from "@/contexts/inventory/application/adjust-stock";
import { createDocumentService, type TradingPorts } from "@/contexts/trading/application/documents";
import { createPrismaIdempotency } from "@/platform/http/idempotency";
import { createRequest, confirmApproval, cancelRequest, cancelApprovedRequest } from "@/platform/workflow/approval-service";
import { computeLineSnapshotSha256 } from "@/contracts/workflow/line-snapshot";
import { serializeDomainEvent, TRADING_EVENT_TYPES } from "@/contracts/events/registry";
import { createTransferService } from "@/contexts/trading/application/transfers";
import { createReceivingService } from "@/contexts/trading/application/receivings";

export const tradingPorts: TradingPorts = {
  adjust: adjustStock,
  async audit(tx, input) {
    await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: input.actorSub },
      action: input.action, targetType: "document", targetId: input.id, requestId: input.requestId,
      before: input.before ? { status: input.before } : {},
      after: { status: input.after, version: input.version } });
  },
  event(type, input) {
    return serializeDomainEvent({ type: TRADING_EVENT_TYPES[type], aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      payload: { eventId: randomUUID(), documentId: input.id, documentVersion: input.version,
        lines: input.lines.map((line) => ({ lineId: line.id, batchId: line.batchId,
          warehouseId: line.warehouseId, originLot: { issuerInstanceId: line.originIssuerInstanceId,
            lotId: line.originLotId }, quantity: line.quantity, unit: line.unit })),
        ...(type === "issue" ? { movementIds: input.movementIds } : {}),
        actorSub: input.actorSub, occurredAt: new Date().toISOString() } });
  },
  submit: createRequest,
  hash: computeLineSnapshotSha256,
  async confirmApproval(tx, input) {
    const db = getPrismaClient();
    await confirmApproval(tx, async (sub) => {
      const membership = await db.membership.findUnique({ where: { keycloakSub: sub },
        include: { warehouses: { select: { warehouseId: true } } } });
      return membership ? { sub, role: membership.role, active: membership.status === "active",
        warehouseIds: membership.role === "administrator"
          ? (await tx.warehouse.findMany({ select: { id: true } })).map((row) => row.id)
          : membership.warehouses.map((row) => row.warehouseId) } : null;
    }, async () => {}, input);
  },
  async cancelApproval(tx, input) {
    const { approved, ...args } = input;
    if (approved) await cancelApprovedRequest(tx, args);
    else await cancelRequest(tx, args);
  },
};
export const tradingService = createDocumentService(tradingPorts);
export const transferService = () => createTransferService(tradingPorts, process.env.NEXORA_ISSUER_INSTANCE_ID ?? "");
export const receivingService = () => createReceivingService(tradingPorts, process.env.NEXORA_ISSUER_INSTANCE_ID ?? "");

export const tradingIdempotency = () => createPrismaIdempotency(getPrismaClient());
export const tradingRead = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  getPrismaClient().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
export const tradingUnitOfWork = () => ({ run: tradingRead });

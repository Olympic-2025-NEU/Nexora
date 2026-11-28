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
import { createTransferService, type TransferPorts } from "@/contexts/trading/application/transfers";
import { createReceivingService, type ReceivingPorts } from "@/contexts/trading/application/receivings";
import { createStocktakeService } from "@/contexts/trading/application/stocktakes";
import { createSaleService } from "@/contexts/trading/application/sales";
import { EVENT_DESTINATIONS } from "@/contracts/events/registry";

export const tradingPorts: TradingPorts & TransferPorts & ReceivingPorts = {
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
  transferEvent(input) {
    return serializeDomainEvent({ type: TRADING_EVENT_TYPES.transfer, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      destinations: [EVENT_DESTINATIONS.traceability],
      payload: { eventId: randomUUID(), transferId: input.id, linkedIssueId: input.linkedIssueId,
        destinationPartnerId: input.destinationPartnerId, lines: input.lines, occurredAt: input.occurredAt } });
  },
  receivingEvent(input) {
    return serializeDomainEvent({ type: TRADING_EVENT_TYPES.receiving, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      destinations: [EVENT_DESTINATIONS.traceability],
      payload: { eventId: randomUUID(), receivingId: input.id,
        sourceIssuerInstanceId: input.sourceIssuerInstanceId,
        sourceTransferId: input.sourceTransferId, sentLines: input.sentLines,
        actualLines: input.actualLines, occurredAt: input.occurredAt,
        ...(input.discrepancyReason ? { discrepancyReason: input.discrepancyReason } : {}) } });
  },
  submit: createRequest,
  hash: computeLineSnapshotSha256,
  async confirmApproval(tx, input) {
    const db = getPrismaClient();
    await confirmApproval(tx, async (sub) => {
      const membership = await db.membership.findUnique({
        where: { keycloakSub: sub },
        include: {
          warehouses: { select: { warehouseId: true } },
          roles: { select: { role: true } },
        },
      });
      if (!membership) return null;
      const roles = membership.roles.map((r) => r.role);
      const jobRoles = roles.length > 0 ? roles : [membership.role];
      return {
        sub,
        roles: jobRoles,
        active: membership.status === "active",
        warehouseIds: jobRoles.includes("administrator")
          ? (await tx.warehouse.findMany({ select: { id: true } })).map((row) => row.id)
          : membership.warehouses.map((row) => row.warehouseId),
      };
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
export const stocktakeService = () => createStocktakeService({ audit: tradingPorts.audit, adjust: adjustStock,
  event(input) {
    return serializeDomainEvent({ type: TRADING_EVENT_TYPES.stocktake, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      payload: { eventId: randomUUID(), documentId: input.id, documentVersion: input.version,
        lines: input.lines, actorSub: input.actorSub, reason: input.reason, occurredAt: input.occurredAt } });
  } });
export const saleService = () => createSaleService({ audit: tradingPorts.audit,
  event(input) {
    return serializeDomainEvent({ type: TRADING_EVENT_TYPES.sale, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      destinations: [EVENT_DESTINATIONS.traceability],
      payload: { eventId: randomUUID(), saleId: input.id, linkedIssueId: input.linkedIssueId,
        lines: input.lines, occurredAt: input.occurredAt } });
  } });

export const tradingIdempotency = () => createPrismaIdempotency(getPrismaClient());
export const tradingRead = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  getPrismaClient().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
export const tradingUnitOfWork = () => ({ run: tradingRead });

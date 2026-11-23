// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import { adjustStock } from "@/contexts/inventory/application/adjust-stock";
import { createDocumentService } from "@/contexts/trading/application/documents";
import { createPrismaIdempotency } from "@/platform/http/idempotency";
import { createRequest, confirmApproval, cancelRequest } from "@/platform/workflow/approval-service";
import { computeLineSnapshotSha256 } from "@/contracts/workflow/line-snapshot";
import { serializeDomainEvent, TRADING_EVENT_TYPES } from "@/contracts/events/registry";

export const tradingService = createDocumentService({
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
  async cancelApproval(tx, input) { await cancelRequest(tx, input); },
});

export const tradingIdempotency = () => createPrismaIdempotency(getPrismaClient());
export const tradingRead = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  getPrismaClient().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
export const tradingUnitOfWork = () => ({ run: tradingRead });

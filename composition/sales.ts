// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createPrismaIdempotency } from "@/platform/http/idempotency";
import { serializeDomainEvent, TRADING_EVENT_TYPES, EVENT_DESTINATIONS } from "@/contracts/events/registry";
import { createSalesOrderService } from "@/contexts/sales/application/orders";
import { tradingPorts } from "@/composition/trading";

export const salesOrderService = () => createSalesOrderService({
  trading: tradingPorts,
  saleAudit: {
    audit: tradingPorts.audit,
    event(input) {
      return serializeDomainEvent({
        type: TRADING_EVENT_TYPES.sale,
        aggregateType: "document",
        aggregateId: input.id,
        aggregateVersion: input.version,
        correlationId: input.correlationId,
        destinations: [EVENT_DESTINATIONS.traceability],
        payload: {
          eventId: randomUUID(),
          saleId: input.id,
          linkedIssueId: input.linkedIssueId,
          lines: input.lines,
          occurredAt: input.occurredAt,
        },
      });
    },
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
});

export const salesIdempotency = () => createPrismaIdempotency(getPrismaClient());
export const salesRead = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  getPrismaClient().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
export const salesUnitOfWork = () => ({ run: salesRead });

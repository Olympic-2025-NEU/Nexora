// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";

export type OutboxEventInput = {
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  schemaVersion: string;
  payload: Prisma.InputJsonValue;
  destination: string;
  correlationId: string;
};

export type OutboxMessage = OutboxEventInput & {
  id: string;
  createdAt: Date;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastErrorCode: string | null;
  deliveredAt: Date | null;
};

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

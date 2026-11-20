// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { OutboxEventInput } from "./message";

export async function appendOutbox(tx: Prisma.TransactionClient, events: OutboxEventInput[]): Promise<void> {
  if (events.length === 0) return;
  for (const event of events) {
    if ((["aggregateType", "aggregateId", "aggregateVersion", "eventType", "schemaVersion",
      "payload", "destination", "correlationId"] as const).some((field) =>
      event[field] === undefined || event[field] === null || event[field] === "") ||
        !Number.isInteger(event.aggregateVersion) || event.aggregateVersion < 0 ||
        typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw new Error("Invalid outbox event");
    }
  }
  await tx.outboxMessage.createMany({ data: events.map((event) => ({ ...event, id: randomUUID() })) });
}

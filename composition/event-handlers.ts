// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EventConsumer port: delivery is at-least-once; effects can succeed before the outbox marks delivery.
 * Key work by payload.eventId and upsert by the source document's natural key
 * (documentId + documentVersion). For transfer, receiving and sale, use their
 * schema-specific source ID (transferId, receivingId, saleId) and aggregateVersion.
 * Check aggregateVersion / documentVersion for gaps: a dead-lettered predecessor
 * does not block successors and may be replayed later. Guard upserts so an older
 * replay cannot regress newer state. Throw transient errors for retryable failures;
 * use PermanentDeliveryError only when retry cannot help.
 */
import { EVENT_DESTINATIONS, validateDomainEvent } from "../contracts/events/registry";
import { PermanentDeliveryError, type OutboxHandler, type OutboxMessage } from "../platform/outbox/message";

export type EventConsumer = (message: OutboxMessage) => Promise<void>;
export type EventConsumerMap = Map<string, EventConsumer>; // key: full .v1 eventType

export function createRoutingHandler(destination: string, consumers: EventConsumerMap): OutboxHandler {
  return async (message) => {
    const log = (outcome: string, reason?: string) => console.log(JSON.stringify({ service: "event-router",
      messageId: message.id, correlationId: message.correlationId, destination,
      eventType: message.eventType, schemaVersion: message.schemaVersion, outcome, ...(reason && { reason }) }));
    const result = validateDomainEvent(message.eventType, message.schemaVersion, message.payload);
    if (!result.ok) {
      log("rejected", result.reason);
      throw new PermanentDeliveryError(result.reason);
    }
    const consumer = consumers.get(message.eventType);
    if (!consumer) {
      log("rejected", "NO_CONSUMER_REGISTERED");
      throw new PermanentDeliveryError("NO_CONSUMER_REGISTERED");
    }
    try {
      await consumer(message);
      log("consumed");
    } catch (error) {
      log("failed", error instanceof PermanentDeliveryError ? error.reason : "DELIVERY_FAILED");
      throw error;
    }
  };
}

export function buildHandlerMap(consumers: { traceability?: EventConsumerMap; federation?: EventConsumerMap;
  workflow?: EventConsumerMap } = {}):
  Map<string, OutboxHandler> {
  return new Map([
    [EVENT_DESTINATIONS.traceability, createRoutingHandler(EVENT_DESTINATIONS.traceability,
      consumers.traceability ?? new Map())],
    [EVENT_DESTINATIONS.federation, createRoutingHandler(EVENT_DESTINATIONS.federation,
      consumers.federation ?? new Map())],
    [EVENT_DESTINATIONS.workflow, createRoutingHandler(EVENT_DESTINATIONS.workflow,
      consumers.workflow ?? new Map())],
  ]);
}

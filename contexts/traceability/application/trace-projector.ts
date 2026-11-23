// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import type { OutboxMessage } from "../../../platform/outbox/message";
import { TRADING_EVENT_TYPES, validateDomainEvent } from "../../../contracts/events/registry";
import { PermanentDeliveryError } from "../../../platform/outbox/message";

export type TraceSource = {
  documentId: string; eventType: string; sourceEventId: string; occurredAt: Date;
  documentVersion: number; batchId: string;
  lines: { sourceLineId: string; quantity: string }[];
  linkedIssueId?: string;
  remoteSource?: { issuerInstanceId: string; transferId: string };
};
export type TraceProjectorPort = {
  append(source: TraceSource, outboxId: string): Promise<void>;
  rebuild(batchId: string): Promise<void>;
};

function asObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function asLines(value: unknown): Record<string, unknown>[] {
  return value as Record<string, unknown>[];
}

export function localEventId(sourceEventId: string, batchId: string): string {
  const bytes = createHash("sha256").update(`${sourceEventId}:${batchId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sourcesFromOutbox(message: OutboxMessage): TraceSource[] {
  const checked = validateDomainEvent(message.eventType, message.schemaVersion, message.payload);
  const allowed = new Set<string>(Object.values(TRADING_EVENT_TYPES));
  if (!checked.ok || !allowed.has(message.eventType) ||
      message.destination !== "traceability" || message.aggregateType !== "document") {
    throw new PermanentDeliveryError(checked.ok ? "TRACE_SOURCE_INVALID" : checked.reason);
  }
  const payload = asObject(message.payload);
  const documentId = String(payload.documentId ?? payload.transferId ?? payload.receivingId ?? payload.saleId);
  if (documentId !== message.aggregateId || typeof payload.eventId !== "string" ||
      typeof payload.occurredAt !== "string") throw new PermanentDeliveryError("TRACE_SOURCE_INVALID");
  const occurredAt = new Date(payload.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new PermanentDeliveryError("TRACE_SOURCE_INVALID");
  const groups = new Map<string, { sourceLineId: string; quantity: string }[]>();
  const receiving = message.eventType === TRADING_EVENT_TYPES.receiving;
  const rows = asLines(receiving ? payload.actualLines : payload.lines);
  for (const row of rows) {
    const batchId = String(receiving ? row.localBatchId : row.batchId);
    const line = { sourceLineId: String(row.sourceLineId ?? row.lineId),
      quantity: String(receiving ? row.actualQuantity : row.quantity ?? row.countedQuantity) };
    groups.set(batchId, [...(groups.get(batchId) ?? []), line]);
  }
  const sourceEventId = payload.eventId;
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([batchId, lines]) => ({
    documentId, eventType: message.eventType, sourceEventId, occurredAt,
    documentVersion: Number(payload.documentVersion ?? message.aggregateVersion), batchId,
    lines: lines.sort((a, b) => a.sourceLineId.localeCompare(b.sourceLineId)),
    ...((message.eventType === TRADING_EVENT_TYPES.transfer || message.eventType === TRADING_EVENT_TYPES.sale)
      ? { linkedIssueId: String(payload.linkedIssueId) } : {}),
    ...(receiving ? { remoteSource: { issuerInstanceId: String(payload.sourceIssuerInstanceId),
      transferId: String(payload.sourceTransferId) } } : {}),
  }));
}

export function createTraceProjector(port: TraceProjectorPort) {
  return async (message: OutboxMessage): Promise<void> => {
    const sources = sourcesFromOutbox(message);
    for (const source of sources) {
      await port.append(source, message.id);
      await port.rebuild(source.batchId);
    }
  };
}

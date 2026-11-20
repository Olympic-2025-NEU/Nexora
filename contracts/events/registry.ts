// SPDX-License-Identifier: AGPL-3.0-only
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Prisma } from "@prisma/client";
import type { OutboxEventInput } from "../../platform/outbox/message";
import receiptV1 from "./trading-receipt-confirmed-v1.schema.json";
import issueV1 from "./trading-issue-confirmed-v1.schema.json";
import transferV1 from "./trading-transfer-confirmed-v1.schema.json";
import receivingV1 from "./trading-receiving-confirmed-v1.schema.json";
import saleV1 from "./trading-sale-recorded-v1.schema.json";
import requestedV1 from "./workflow-approval-requested-v1.schema.json";
import decisionRequestedV1 from "./workflow-approval-decision-requested-v1.schema.json";
import startedV1 from "./workflow-approval-started-v1.schema.json";
import approvedV1 from "./workflow-approval-approved-v1.schema.json";
import rejectedV1 from "./workflow-approval-rejected-v1.schema.json";

export const EVENT_DESTINATIONS = { traceability: "traceability", federation: "federation", workflow: "workflow" } as const;
export const WORKFLOW_EVENT_TYPES = {
  requested: "workflow.approval.requested.v1",
  decisionRequested: "workflow.approval.decision_requested.v1",
  started: "workflow.approval.started.v1",
  approved: "workflow.approval.approved.v1",
  rejected: "workflow.approval.rejected.v1",
} as const;
export const TRADING_EVENT_TYPES = {
  receipt: "trading.receipt.confirmed.v1",
  issue: "trading.issue.confirmed.v1",
  transfer: "trading.transfer.confirmed.v1",
  receiving: "trading.receiving.confirmed.v1",
  sale: "trading.sale.recorded.v1",
} as const;

export type TradingEventType = (typeof TRADING_EVENT_TYPES)[keyof typeof TRADING_EVENT_TYPES];
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[keyof typeof WORKFLOW_EVENT_TYPES];
type Destination = (typeof EVENT_DESTINATIONS)[keyof typeof EVENT_DESTINATIONS];
export type EventFailureReason = "UNSUPPORTED_EVENT_TYPE" | "UNSUPPORTED_EVENT_VERSION" | "INVALID_EVENT_PAYLOAD";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const entries = [
  [TRADING_EVENT_TYPES.receipt, receiptV1, [EVENT_DESTINATIONS.traceability]],
  [TRADING_EVENT_TYPES.issue, issueV1, [EVENT_DESTINATIONS.traceability]],
  [TRADING_EVENT_TYPES.transfer, transferV1, [EVENT_DESTINATIONS.traceability, EVENT_DESTINATIONS.federation]],
  [TRADING_EVENT_TYPES.receiving, receivingV1, [EVENT_DESTINATIONS.traceability, EVENT_DESTINATIONS.federation]],
  [TRADING_EVENT_TYPES.sale, saleV1, [EVENT_DESTINATIONS.traceability, EVENT_DESTINATIONS.federation]],
  [WORKFLOW_EVENT_TYPES.requested, requestedV1, [EVENT_DESTINATIONS.workflow]],
  [WORKFLOW_EVENT_TYPES.decisionRequested, decisionRequestedV1, [EVENT_DESTINATIONS.workflow]],
  [WORKFLOW_EVENT_TYPES.started, startedV1, [EVENT_DESTINATIONS.workflow]],
  [WORKFLOW_EVENT_TYPES.approved, approvedV1, [EVENT_DESTINATIONS.workflow]],
  [WORKFLOW_EVENT_TYPES.rejected, rejectedV1, [EVENT_DESTINATIONS.workflow]],
] as const;
const registry = new Map(entries.map(([type, schema, destinations]) =>
  [type, { validate: ajv.compile(schema), destinations }]));
const bases = new Set(entries.map(([type]) => type.replace(/\.v\d+$/, "")));

export function validateDomainEvent(eventType: string, schemaVersion: string, payload: unknown):
  { ok: true } | { ok: false; reason: EventFailureReason } {
  const entry = registry.get(eventType as TradingEventType | WorkflowEventType);
  if (!entry) return { ok: false, reason: bases.has(eventType.replace(/\.v\d+$/, ""))
    ? "UNSUPPORTED_EVENT_VERSION" : "UNSUPPORTED_EVENT_TYPE" };
  if (schemaVersion !== "1") return { ok: false, reason: "UNSUPPORTED_EVENT_VERSION" };
  return entry.validate(payload) ? { ok: true } : { ok: false, reason: "INVALID_EVENT_PAYLOAD" };
}

export function serializeDomainEvent(input: {
  type: TradingEventType | WorkflowEventType;
  payload: Prisma.InputJsonValue;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  destinations?: readonly Destination[];
}): OutboxEventInput[] {
  const result = validateDomainEvent(input.type, "1", input.payload);
  if (!result.ok) {
    const detail = result.reason === "INVALID_EVENT_PAYLOAD"
      ? ajv.errorsText(registry.get(input.type)?.validate.errors) : result.reason;
    throw new Error(`${result.reason}: ${detail}`);
  }
  const destinations = input.destinations ?? registry.get(input.type)!.destinations;
  return destinations.map((destination) => ({ aggregateType: input.aggregateType,
    aggregateId: input.aggregateId, aggregateVersion: input.aggregateVersion,
    eventType: input.type, schemaVersion: "1", payload: input.payload,
    correlationId: input.correlationId, destination }));
}

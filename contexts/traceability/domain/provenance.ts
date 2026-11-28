// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceTypes = new Set([
  "trading.receipt.confirmed.v1", "trading.issue.confirmed.v1",
  "trading.transfer.confirmed.v1", "trading.receiving.confirmed.v1",
  "trading.stocktake.confirmed.v1", "trading.sale.recorded.v1",
]);
export type LinkRelation = "derived_from" | "transferred_to" | "received_from" | "sold_as" | "corrects";
export type VerificationState = "local_verified" | "partner_asserted" | "missing";

export class ProvenanceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ProvenanceError"; }
}

export interface LocalTraceEventInput {
  issuerInstanceId: string;
  externalEventId: string;
  eventType: string;
  batchId: string;
  documentId: string;
  originIssuerInstanceId: string;
  originLotId: string;
  occurredAt: Date;
  payloadVersion: string;
  summary: Record<string, unknown>;
  evidenceRefs?: string[];
}

export function makeLocalTraceEvent(input: LocalTraceEventInput) {
  if (!sourceTypes.has(input.eventType) || !uuid.test(input.externalEventId) ||
      !uuid.test(input.batchId) || !uuid.test(input.documentId) ||
      ![input.issuerInstanceId, input.originIssuerInstanceId, input.originLotId]
        .every((value) => typeof value === "string" && value.trim().length > 0 && value.length <= 128) ||
      input.payloadVersion !== "1" || !(input.occurredAt instanceof Date) ||
      !Number.isFinite(input.occurredAt.getTime()) || !input.summary ||
      Array.isArray(input.summary) || typeof input.summary !== "object" ||
      (input.evidenceRefs !== undefined && (!Array.isArray(input.evidenceRefs) ||
        input.evidenceRefs.length > 100 || !input.evidenceRefs.every((id) => uuid.test(id))))) {
    throw new ProvenanceError("TRACE_SOURCE_INVALID");
  }
  const evidenceRefs = input.evidenceRefs ?? [];
  const bytes = canonicalize({ summary: input.summary, evidenceRefs });
  if (!bytes || Buffer.byteLength(bytes) > 16 * 1024) throw new ProvenanceError("TRACE_SUMMARY_INVALID");
  return { ...input, evidenceRefs, id: randomUUID(), verificationState: "local_verified" as const,
    checksumHex: createHash("sha256").update(bytes).digest("hex") };
}

export interface TraceLinkInput {
  fromEventId: string;
  toEventId?: string;
  missingRef?: { issuerInstanceId: string; eventId: string };
  relation: LinkRelation;
  verificationState: VerificationState;
}

export function makeTraceLink(input: TraceLinkInput) {
  const missing = input.missingRef;
  if (!uuid.test(input.fromEventId) || Boolean(input.toEventId) === Boolean(missing) ||
      (input.toEventId && (!uuid.test(input.toEventId) || input.fromEventId === input.toEventId)) ||
      !["derived_from", "transferred_to", "received_from", "sold_as", "corrects"].includes(input.relation) ||
      !["local_verified", "partner_asserted", "missing"].includes(input.verificationState) ||
      Boolean(missing) !== (input.verificationState === "missing") ||
      (missing && (Object.keys(missing).sort().join(",") !== "eventId,issuerInstanceId" ||
        ![missing.issuerInstanceId, missing.eventId].every((value) =>
          typeof value === "string" && value.trim().length > 0 && value.length <= 128)))) {
    throw new ProvenanceError("TRACE_LINK_INVALID");
  }
  return { ...input, id: randomUUID() };
}

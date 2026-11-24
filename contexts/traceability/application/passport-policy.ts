// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "../../../platform/kernel/errors";

export const PASSPORT_FIELDS = ["organization", "product", "batch", "timeline", "evidence"] as const;
export type PassportField = typeof PASSPORT_FIELDS[number];
export type Visibility = "private" | "partner" | "public";
export type PassportAccess = Record<PassportField, Visibility>;
export type PassportSource = {
  productName: string; publicLotCode: string; originIssuer: string;
  approvedAt: Date;
  projectionPending?: boolean;
  events: { id: string; type: string; occurredAt: Date; recordedAt: Date;
    issuer: string; sourceId: string; verificationState: string; confirmed: boolean;
    checksumValid: boolean; sentQuantity?: string; actualQuantity?: string;
    evidence: { id: string; checksum: string; visibility: string; state: string;
      scanState: string; bucket: string; fileChecksum: string }[];
    links: { toEventId: string | null; missingRef: unknown }[] }[];
};

export function parsePassportAccess(input: unknown): PassportAccess {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("PASSPORT_POLICY_INVALID", 422);
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== PASSPORT_FIELDS.length ||
      Object.keys(value).some((key) => !PASSPORT_FIELDS.includes(key as PassportField)))
    throw new DomainError("PASSPORT_POLICY_INVALID", 422);
  const access = {} as PassportAccess;
  for (const field of PASSPORT_FIELDS) {
    if (!["private", "partner", "public"].includes(String(value[field])))
      throw new DomainError("PASSPORT_POLICY_INVALID", 422);
    access[field] = value[field] as Visibility;
  }
  return access;
}

export function canPublishPassport(access: PassportAccess) {
  return access.organization === "public" && access.product === "public" &&
    access.batch === "public";
}

/** Construct an exact public allowlist; raw event/document/attachment rows never cross this boundary. */
export function buildPassportPayload(access: PassportAccess, source: PassportSource) {
  if (!canPublishPassport(access)) throw new DomainError("PASSPORT_NOT_PUBLIC", 409);
  const events = source.events.filter((event) => event.confirmed &&
    event.verificationState === "local_verified" && event.checksumValid);
  const gaps = new Set<string>();
  if (!events.length) gaps.add("no_confirmed_trace_events");
  if (source.projectionPending) gaps.add("projection_pending");
  if (source.events.some((event) => event.verificationState === "partner_asserted"))
    gaps.add("partner_source_unverified");
  if (source.events.some((event) => !event.confirmed || !event.checksumValid))
    gaps.add("source_investigation");
  for (const event of events) {
    if (event.links.some((link) => link.missingRef)) gaps.add("remote_source_unavailable");
    if (event.type === "trading.issue.confirmed.v1" && !event.links.some((link) => link.toEventId))
      gaps.add("local_allocation_unknown");
    if (event.sentQuantity !== undefined && event.actualQuantity !== undefined &&
        event.sentQuantity !== event.actualQuantity) gaps.add("receiving_discrepancy");
    if (access.evidence === "public" && event.evidence.some((row) => row.visibility === "public" &&
        row.state === "active" && (row.scanState !== "clean" || row.bucket !== "private" ||
        row.checksum !== row.fileChecksum))) gaps.add("evidence_investigation");
  }
  if (access.timeline !== "public") gaps.add("timeline_not_disclosed");
  const latest = Math.max(source.approvedAt.getTime(),
    ...events.map((event) => event.recordedAt.getTime()));
  let evidenceBudget = 10;
  const timeline = access.timeline === "public" ? events.map((event) => ({
    type: event.type, occurredAt: event.occurredAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(), issuer: event.issuer,
    sourceId: event.sourceId,
    verificationState: event.links.some((link) => link.missingRef) ||
      (event.type === "trading.issue.confirmed.v1" &&
        !event.links.some((link) => link.toEventId)) ||
      (event.sentQuantity !== undefined && event.actualQuantity !== undefined &&
        event.sentQuantity !== event.actualQuantity) ? "partial" : "confirmed",
    ...(event.sentQuantity !== undefined ? { sentQuantity: event.sentQuantity } : {}),
    ...(event.actualQuantity !== undefined ? { actualQuantity: event.actualQuantity } : {}),
    evidence: access.evidence === "public" ? event.evidence.filter((row) =>
      row.visibility === "public" && row.state === "active" && row.scanState === "clean" &&
      row.bucket === "private" && row.checksum === row.fileChecksum)
      .map((row) => ({ id: row.id, checksum: row.checksum })) : [],
  })).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) ||
    a.recordedAt.localeCompare(b.recordedAt) || a.sourceId.localeCompare(b.sourceId)) : [];
  for (const item of timeline) {
    if (item.evidence.length > evidenceBudget) gaps.add("evidence_truncated");
    item.evidence = item.evidence.slice(0, evidenceBudget);
    evidenceBudget -= item.evidence.length;
  }
  return {
    payload: { productName: source.productName, publicLotCode: source.publicLotCode,
      originIssuer: source.originIssuer, timeline,
      verificationState: !events.length ? "unknown" : gaps.size ? "partial" : "confirmed",
      gaps: [...gaps].sort(), asOf: new Date(latest).toISOString() },
    sourceEventIds: events.map((event) => event.id).sort(),
  };
}

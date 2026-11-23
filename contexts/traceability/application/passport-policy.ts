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
    verificationState: string; confirmed: boolean;
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
    event.verificationState === "local_verified");
  const gaps = new Set<string>();
  if (!events.length) gaps.add("no_confirmed_trace_events");
  if (source.projectionPending) gaps.add("projection_pending");
  if (source.events.some((event) => event.verificationState === "partner_asserted"))
    gaps.add("partner_source_unverified");
  for (const event of events) {
    if (event.links.some((link) => link.missingRef)) gaps.add("remote_source_unavailable");
    if (event.type === "trading.issue.confirmed.v1" && !event.links.some((link) => link.toEventId))
      gaps.add("local_allocation_unknown");
  }
  if (access.timeline !== "public") gaps.add("timeline_not_disclosed");
  // Evidence is added by T07 only after clean scan and attachment-level public authorization.
  const latest = Math.max(source.approvedAt.getTime(),
    ...events.map((event) => event.recordedAt.getTime()));
  const timeline = access.timeline === "public" ? events.map((event) => ({
    type: event.type, occurredAt: event.occurredAt.toISOString(),
    verificationState: "confirmed",
  })).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) ||
    a.type.localeCompare(b.type)) : [];
  return {
    payload: { productName: source.productName, publicLotCode: source.publicLotCode,
      originIssuer: source.originIssuer, timeline,
      verificationState: !events.length ? "unknown" : gaps.size ? "partial" : "confirmed",
      gaps: [...gaps].sort(), asOf: new Date(latest).toISOString() },
    sourceEventIds: events.map((event) => event.id).sort(),
  };
}

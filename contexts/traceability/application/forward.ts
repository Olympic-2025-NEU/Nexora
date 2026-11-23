// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { DomainError } from "../../../platform/kernel/errors";
import { BACKWARD_MAX_NODES, type BackwardEvent } from "./backward";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ForwardEvent = Omit<BackwardEvent, "outgoing"> & {
  incoming: { fromEventId: string; relation: string; verificationState: string }[];
};
export type ImpactLine = { eventId: string; sourceDocumentId: string; sourceLineId: string;
  kind: "issue" | "transfer" | "receiving" | "sale"; quantity: string; uomId: string;
  uomCode?: string;
  verificationState: "confirmed" | "partner_asserted";
  sourceIssueLineId?: string; sentQuantity?: string; actualQuantity?: string;
  partner?: { id?: string; issuerInstanceId: string } };
export type ForwardPort = {
  batchExists(batchId: string): Promise<boolean>;
  roots(batchId: string, asOf: Date): Promise<ForwardEvent[]>;
  event(id: string, asOf: Date): Promise<ForwardEvent | null>;
  impact(events: ForwardEvent[]): Promise<ImpactLine[]>;
  pending(): Promise<{ pending: number; seconds: number }>;
};
export type ForwardInput = { batchId: string; depth?: number; limit?: number; cursor?: string | null };

function parseCursor(input: ForwardInput, depth: number): { asOf: Date; offset: number } {
  if (input.cursor === null || input.cursor === undefined) return { asOf: new Date(), offset: 0 };
  if (input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor))
    throw new DomainError("CURSOR_INVALID", 422);
  try {
    const bytes = Buffer.from(input.cursor, "base64url");
    if (bytes.toString("base64url") !== input.cursor) throw new Error("non-canonical");
    const value = JSON.parse(bytes.toString("utf8"));
    const asOf = new Date(value.asOf);
    if (value.direction !== "forward" || value.batchId !== input.batchId ||
        value.depth !== depth || !Number.isInteger(value.offset) || value.offset < 0 ||
        value.offset > BACKWARD_MAX_NODES || !Number.isFinite(asOf.getTime()) ||
        asOf.getTime() > Date.now() + 1000) throw new Error("mismatch");
    return { asOf, offset: value.offset as number };
  } catch { throw new DomainError("CURSOR_INVALID", 422); }
}

export async function forwardTrace(port: ForwardPort, actor: Actor, input: ForwardInput) {
  if (!checkPolicy(actor, "trace:read").allowed) throw new DomainError("POLICY_DENIED", 403);
  const depth = input.depth ?? 3;
  const limit = input.limit ?? 20;
  if (!UUID.test(input.batchId) || !Number.isInteger(depth) || depth < 1 || depth > 10 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new DomainError("TRACE_QUERY_INVALID", 422);
  const { asOf, offset } = parseCursor(input, depth);
  if (!await port.batchExists(input.batchId)) throw new DomainError("BATCH_NOT_FOUND", 404);
  const roots = await port.roots(input.batchId, asOf);
  const queue = roots.map((event) => ({ event, depth: 0 }));
  const visited = new Set<string>();
  const ordered: { event: ForwardEvent; depth: number }[] = [];
  const gaps: { fromEventId?: string; state: "missing" | "pending" | "unknown";
    reason: string; partnerIssuerInstanceId?: string }[] = [];
  if (!roots.length) gaps.push({ state: "missing", reason: "local_source_unavailable" });
  let truncated = false;
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.event.id)) continue;
    if (ordered.length >= BACKWARD_MAX_NODES) { truncated = true; break; }
    visited.add(current.event.id);
    ordered.push(current);
    for (const link of current.event.incoming) {
      if (visited.has(link.fromEventId)) continue;
      if (current.depth >= depth) {
        gaps.push({ fromEventId: current.event.id, state: "pending", reason: "depth_limit" });
      } else {
        const target = await port.event(link.fromEventId, asOf);
        if (target) queue.push({ event: target, depth: current.depth + 1 });
        else gaps.push({ fromEventId: current.event.id, state: "missing",
          reason: "local_source_unavailable" });
      }
    }
  }
  if (truncated) gaps.push({ state: "pending", reason: "node_limit" });
  if (offset > ordered.length || (offset === ordered.length && offset !== 0))
    throw new DomainError("CURSOR_INVALID", 422);
  const page = ordered.slice(offset, offset + limit);
  const ids = new Set(page.map(({ event }) => event.id));
  const impact = await port.impact(page.map(({ event }) => event));
  for (const row of impact) {
    if (row.kind === "transfer" && row.partner &&
        !gaps.some((gap) => gap.fromEventId === row.eventId && gap.reason === "downstream_unreported"))
      gaps.push({ fromEventId: row.eventId, state: "unknown",
        reason: "downstream_unreported", partnerIssuerInstanceId: row.partner.issuerInstanceId });
  }
  const lag = await port.pending();
  if (lag.pending) gaps.push({ state: "pending", reason: "projection_pending" });
  const nodes = page.map(({ event, depth: hop }) => {
    const summary = event.summary && typeof event.summary === "object" &&
      !Array.isArray(event.summary) ? event.summary as Record<string, unknown> : {};
    return { eventId: event.id, issuerInstanceId: event.issuerInstanceId,
      batchId: event.batchId, originLot: { issuerInstanceId: event.originIssuerInstanceId,
        lotId: event.originLotId }, eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(), recordedAt: event.createdAt.toISOString(),
      verificationState: event.verificationState, depth: hop,
      source: { documentId: event.documentId, eventId: String(summary.sourceEventId ??
        event.externalEventId), payloadVersion: event.payloadVersion } };
  });
  const edges = page.flatMap(({ event }) => event.incoming.map((link) => ({
    fromEventId: event.id, toEventId: link.fromEventId,
    relation: "source_of", sourceRelation: link.relation,
    verificationState: link.verificationState,
  })));
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < ordered.length ? Buffer.from(JSON.stringify({
    direction: "forward", batchId: input.batchId, depth,
    asOf: asOf.toISOString(), offset: nextOffset,
  })).toString("base64url") : undefined;
  return { root: { batchId: input.batchId }, nodes, edges,
    gaps: gaps.filter((gap) => !gap.fromEventId || ids.has(gap.fromEventId)), impact,
    asOf: asOf.toISOString(), localProjection: {
      state: lag.pending ? lag.seconds > 300 ? "lagging" : "pending" : "caught_up",
      pendingEvents: lag.pending }, truncated, ...(nextCursor ? { nextCursor } : {}) };
}

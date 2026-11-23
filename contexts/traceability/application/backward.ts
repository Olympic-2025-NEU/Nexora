// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { DomainError } from "../../../platform/kernel/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BACKWARD_MAX_NODES = 2000;
type Ref = { issuerInstanceId: string; eventId: string };
export type BackwardLink = { toEventId: string | null; missingRef: Ref | null;
  relation: string; verificationState: string };
export type BackwardEvent = { id: string; issuerInstanceId: string; batchId: string | null;
  originIssuerInstanceId: string; originLotId: string; eventType: string;
  documentId: string | null; externalEventId: string; payloadVersion: string;
  summary: unknown; occurredAt: Date; createdAt: Date; verificationState: string;
  outgoing: BackwardLink[] };
export type BackwardPort = {
  batchExists(batchId: string): Promise<boolean>;
  roots(batchId: string, documentId: string | undefined, asOf: Date): Promise<BackwardEvent[]>;
  event(id: string, asOf: Date): Promise<BackwardEvent | null>;
  pending(): Promise<{ pending: number; seconds: number }>;
};
export type BackwardInput = { batchId: string; documentId?: string; depth?: number;
  limit?: number; cursor?: string | null };

function pageCursor(input: BackwardInput) {
  if (input.cursor === null || input.cursor === undefined) return { asOf: new Date(), offset: 0 };
  if (input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor))
    throw new DomainError("CURSOR_INVALID", 422);
  try {
    const decoded = Buffer.from(input.cursor, "base64url");
    if (decoded.toString("base64url") !== input.cursor) throw new Error("non-canonical");
    const value = JSON.parse(decoded.toString("utf8"));
    const asOf = new Date(value.asOf);
    if (value.batchId !== input.batchId || value.documentId !== (input.documentId ?? null) ||
        value.depth !== (input.depth ?? 3) || !Number.isInteger(value.offset) ||
        value.offset < 0 || value.offset > BACKWARD_MAX_NODES || !Number.isFinite(asOf.getTime()) ||
        asOf.getTime() > Date.now() + 1000) throw new Error("mismatch");
    return { asOf, offset: value.offset as number };
  } catch { throw new DomainError("CURSOR_INVALID", 422); }
}

export async function backwardTrace(port: BackwardPort, actor: Actor, input: BackwardInput) {
  if (!checkPolicy(actor, "trace:read").allowed) throw new DomainError("POLICY_DENIED", 403);
  const depth = input.depth ?? 3;
  const limit = input.limit ?? 20;
  if (!UUID.test(input.batchId) || (input.documentId !== undefined && !UUID.test(input.documentId)) ||
      !Number.isInteger(depth) || depth < 1 || depth > 10 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new DomainError("TRACE_QUERY_INVALID", 422);
  const { asOf, offset } = pageCursor(input);
  if (!await port.batchExists(input.batchId)) throw new DomainError("BATCH_NOT_FOUND", 404);
  const roots = await port.roots(input.batchId, input.documentId, asOf);
  if (input.documentId && !roots.length) throw new DomainError("TRACE_SOURCE_NOT_FOUND", 404);
  const queue = roots.map((event) => ({ event, depth: 0 }));
  const visited = new Set<string>();
  const ordered: { event: BackwardEvent; depth: number }[] = [];
  const gaps: { fromEventId?: string; missingRef?: Ref; state: "missing" | "pending";
    reason: string }[] = [];
  if (!roots.length) gaps.push({ state: "missing", reason: "local_source_unavailable" });
  let truncated = false;
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.event.id)) continue;
    if (ordered.length >= BACKWARD_MAX_NODES) { truncated = true; break; }
    visited.add(current.event.id);
    ordered.push(current);
    if (current.event.eventType === "trading.issue.confirmed.v1" &&
        !current.event.outgoing.length) gaps.push({ fromEventId: current.event.id,
          state: "missing", reason: "local_allocation_unknown" });
    for (const link of current.event.outgoing) {
      if (link.missingRef) {
        gaps.push({ fromEventId: current.event.id, missingRef: link.missingRef,
          state: "missing", reason: "remote_source_unavailable" });
      } else if (link.toEventId && !visited.has(link.toEventId)) {
        if (current.depth >= depth) {
          gaps.push({ fromEventId: current.event.id, state: "pending", reason: "depth_limit" });
        } else {
          const target = await port.event(link.toEventId, asOf);
          if (target) queue.push({ event: target, depth: current.depth + 1 });
          else gaps.push({ fromEventId: current.event.id, state: "missing",
            reason: "local_source_unavailable" });
        }
      }
    }
  }
  if (truncated) gaps.push({ state: "pending", reason: "node_limit" });
  const lag = await port.pending();
  if (lag.pending) gaps.push({ state: "pending", reason: "projection_pending" });
  if (offset > ordered.length || (offset === ordered.length && offset !== 0))
    throw new DomainError("CURSOR_INVALID", 422);
  const page = ordered.slice(offset, offset + limit);
  const ids = new Set(page.map(({ event }) => event.id));
  const pageGaps = gaps.filter((gap) => !gap.fromEventId || ids.has(gap.fromEventId));
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
  const edges = page.flatMap(({ event }) => event.outgoing.map((link) => ({
    fromEventId: event.id, ...(link.toEventId ? { toEventId: link.toEventId } : {}),
    ...(link.missingRef ? { missingRef: link.missingRef } : {}),
    relation: link.relation, verificationState: link.verificationState,
  })));
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < ordered.length ? Buffer.from(JSON.stringify({
    batchId: input.batchId, documentId: input.documentId ?? null, depth,
    asOf: asOf.toISOString(), offset: nextOffset,
  })).toString("base64url") : undefined;
  return { root: { batchId: input.batchId, ...(input.documentId ? { documentId: input.documentId } : {}) },
    nodes, edges, gaps: pageGaps, asOf: asOf.toISOString(),
    localProjection: { state: lag.pending ? lag.seconds > 300 ? "lagging" : "pending" : "caught_up",
      pendingEvents: lag.pending }, truncated, ...(nextCursor ? { nextCursor } : {}) };
}

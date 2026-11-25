// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FederationEnvelope } from "../../../contracts/events/federation";
import { applyTraceSummary, type TraceSummaryEnvelope } from "./trace-summary";
import { MappingError } from "./mapping-error";
export { MappingError } from "./mapping-error";

type Tx = Prisma.TransactionClient;
type Lot = { sourceLineId: string; originLot: { issuerInstanceId: string; lotId: string };
  senderBatch: { instanceId: string; batchId: string }; quantity: string; unit: string };
type Ref = { issuerInstanceId: string; messageId: string; eventId: string };
type Payload = FederationEnvelope & { lots: Lot[]; upstreamReferences: Ref[];
  sharingPolicyVersion: string; sourceDocument: { type: string; id: string; version: number };
  impactType?: string; downstreamPartnerRef?: string; disclosureScope?: string;
  sourceEventRefs?: { issuerInstanceId: string; eventId: string }[] };

function payloadOf(value: Prisma.JsonValue): Payload { return value as unknown as Payload; }
function traceId(envelope: Payload, lot: Lot): string {
  return `${envelope.eventId}:${lot.sourceLineId}`;
}
function summary(envelope: Payload, lot: Lot) {
  // Explicit partner allowlist. Never copy remote product master data or raw document.
  return { schemaVersion: envelope.schemaVersion, sharingPolicyVersion: envelope.sharingPolicyVersion,
    assertedBy: envelope.issuerInstanceId, originLot: lot.originLot,
    senderBatch: lot.senderBatch, sourceLineId: lot.sourceLineId,
    quantity: lot.quantity, unit: lot.unit,
    sourceDocument: envelope.sourceDocument,
    upstreamReferences: envelope.upstreamReferences,
    ...(envelope.eventType === "downstream.impact.v1" ? {
      impactType: envelope.impactType, downstreamPartnerRef: envelope.downstreamPartnerRef,
      disclosureScope: envelope.disclosureScope, sourceEventRefs: envelope.sourceEventRefs,
    } : {}) };
}
function checksum(value: object): string {
  const bytes = canonicalize(value);
  if (!bytes || Buffer.byteLength(bytes) > 16 * 1024) throw new MappingError("TRACE_SUMMARY_TOO_LARGE", 422);
  return createHash("sha256").update(bytes).digest("hex");
}
function sameLot(a: Lot["originLot"], b: Lot["originLot"]): boolean {
  return a.issuerInstanceId === b.issuerInstanceId && a.lotId === b.lotId;
}

/** Reject an already-known ancestry loop before persisting the new inbox row. */
export async function assertAcyclic(tx: Tx, envelope: Payload): Promise<void> {
  const target = `${envelope.issuerInstanceId}:${envelope.messageId}`;
  const seen = new Set<string>();
  async function visit(ref: Ref, depth: number): Promise<void> {
    const key = `${ref.issuerInstanceId}:${ref.messageId}`;
    if (key === target) throw new MappingError("DEPENDENCY_CYCLE");
    if (seen.has(key)) return;
    if (depth > 100) throw new MappingError("DEPENDENCY_CHAIN_TOO_DEEP", 422);
    seen.add(key);
    const parent = await tx.inboxMessage.findUnique({ where: { issuerInstanceId_messageId:
      { issuerInstanceId: ref.issuerInstanceId, messageId: ref.messageId } } });
    if (!parent) return;
    if (parent.eventId !== ref.eventId) throw new MappingError("UPSTREAM_EVENT_MISMATCH");
    for (const next of payloadOf(parent.payload).upstreamReferences) await visit(next, depth + 1);
  }
  for (const ref of envelope.upstreamReferences) await visit(ref, 0);
}

async function upstream(tx: Tx, ref: Ref, lot: Lot): Promise<string | null> {
  const parent = await tx.inboxMessage.findUnique({ where: { issuerInstanceId_messageId:
    { issuerInstanceId: ref.issuerInstanceId, messageId: ref.messageId } } });
  if (!parent) {
    const local = await tx.outboxMessage.findFirst({ where: {
      eventType: "transfer.announced.v1",
      payload: { path: ["messageId"], equals: ref.messageId } } });
    const localPayload = local?.payload as { eventId?: string } | undefined;
    if (localPayload?.eventId === ref.eventId) {
      const event = await tx.traceEvent.findFirst({ where: {
        documentId: local!.aggregateId,
        originIssuerInstanceId: lot.originLot.issuerInstanceId,
        originLotId: lot.originLot.lotId,
        issuerInstanceId: ref.issuerInstanceId,
        eventType: "trading.transfer.confirmed.v1" }, select: { id: true } });
      if (event) return event.id;
    }
    const candidates = await tx.traceEvent.findMany({ where: {
      issuerInstanceId: ref.issuerInstanceId,
      originIssuerInstanceId: lot.originLot.issuerInstanceId,
      originLotId: lot.originLot.lotId, eventType: "transfer.announced.v1" }, take: 100 });
    for (const event of candidates) {
      const safe = event.summary as { sourceMessageRef?: Ref } | null;
      if (safe?.sourceMessageRef?.messageId === ref.messageId &&
          safe.sourceMessageRef.eventId === ref.eventId &&
          await tx.federatedTraceSummary.findFirst({ where: {
            issuerInstanceId: event.issuerInstanceId,
            externalEventId: event.externalEventId, state: "active" } })) return event.id;
    }
    return null;
  }
  if (parent.eventId !== ref.eventId) throw new MappingError("UPSTREAM_EVENT_MISMATCH");
  const parentLots = payloadOf(parent.payload).lots;
  if (!parentLots.some((candidate) => sameLot(candidate.originLot, lot.originLot)))
    throw new MappingError("UNKNOWN_LOT_MAPPING");
  const trace = await tx.traceEvent.findFirst({ where: { sourceMessageId: parent.id,
    originIssuerInstanceId: lot.originLot.issuerInstanceId,
    originLotId: lot.originLot.lotId }, select: { id: true } });
  return trace?.id ?? null;
}

/** Idempotent trace projection. A missing local batch or parent remains an explicit gap. */
export async function resolveInbox(tx: Tx, inboxId: string): Promise<"validated" | "pending_dependency" | "applied_to_trace"> {
  const inbox = await tx.inboxMessage.findUniqueOrThrow({ where: { id: inboxId } });
  if (inbox.state === "applied_to_trace") return "applied_to_trace";
  const envelope = payloadOf(inbox.payload);
  if (envelope.eventType === "trace.summary.v1")
    return applyTraceSummary(tx, inboxId, envelope as unknown as TraceSummaryEnvelope);
  if (!envelope.lots.length) return "validated"; // zero actual receipt, T06 business handling
  let missingMapping = false;
  let missingParent = false;
  for (const lot of envelope.lots) {
    if (lot.senderBatch.instanceId !== envelope.issuerInstanceId)
      throw new MappingError("SENDER_BATCH_ISSUER_MISMATCH", 422);
    let mapping = await tx.identityMapping.findUnique({ where: {
      senderInstanceId_senderBatchId_originIssuerInstanceId_originLotId: {
        senderInstanceId: lot.senderBatch.instanceId, senderBatchId: lot.senderBatch.batchId,
        originIssuerInstanceId: lot.originLot.issuerInstanceId, originLotId: lot.originLot.lotId,
      } } });
    if (!mapping && envelope.eventType === "downstream.impact.v1") {
      const receivedLine = await tx.businessReceiptLine.findFirst({ where: {
        receiverBatchId: lot.senderBatch.batchId,
        receipt: { issuerInstanceId: envelope.issuerInstanceId },
        sourceLine: { batch: { originIssuerInstanceId: lot.originLot.issuerInstanceId,
          originLotId: lot.originLot.lotId } } },
        include: { sourceLine: { select: { batchId: true } } } });
      if (receivedLine) mapping = await tx.identityMapping.create({ data: {
        id: randomUUID(), senderInstanceId: lot.senderBatch.instanceId,
        senderBatchId: lot.senderBatch.batchId,
        originIssuerInstanceId: lot.originLot.issuerInstanceId,
        originLotId: lot.originLot.lotId, localBatchId: receivedLine.sourceLine.batchId,
        sourceMessageId: inbox.id, verificationState: "partner_asserted" } });
    }
    if (!mapping) { missingMapping = true; continue; }
    const safe = summary(envelope, lot);
    const externalEventId = traceId(envelope, lot);
    let event = await tx.traceEvent.findUnique({ where: { issuerInstanceId_externalEventId: {
      issuerInstanceId: envelope.issuerInstanceId, externalEventId } } });
    if (!event) event = await tx.traceEvent.create({ data: { id: randomUUID(), issuerInstanceId: envelope.issuerInstanceId,
        externalEventId, eventType: envelope.eventType, batchId: mapping.localBatchId,
        sourceMessageId: inbox.id, originIssuerInstanceId: lot.originLot.issuerInstanceId,
        originLotId: lot.originLot.lotId, occurredAt: new Date(envelope.occurredAt),
        verificationState: "partner_asserted", payloadVersion: envelope.schemaVersion,
        summary: safe, checksumHex: checksum(safe) } });
    const waiting = await tx.traceLink.findMany({ where: { verificationState: "missing",
      missingRef: { equals: { issuerInstanceId: envelope.issuerInstanceId,
        eventId: envelope.eventId } },
      fromEvent: { originIssuerInstanceId: lot.originLot.issuerInstanceId,
        originLotId: lot.originLot.lotId } } });
    for (const link of waiting) await tx.traceLink.update({ where: { id: link.id },
      data: { toEventId: event.id, missingRef: Prisma.DbNull,
        verificationState: "partner_asserted" } });
    for (const ref of envelope.upstreamReferences) {
      const parentId = await upstream(tx, ref, lot);
      const missingRef = { issuerInstanceId: ref.issuerInstanceId, eventId: ref.eventId };
      const existing = await tx.traceLink.findFirst({ where: { fromEventId: event.id,
        relation: "received_from", OR: [{ missingRef: { equals: missingRef } },
          ...(parentId ? [{ toEventId: parentId }] : [])] } });
      if (parentId) {
        if (existing?.toEventId === parentId) continue;
        if (existing) await tx.traceLink.update({ where: { id: existing.id },
          data: { toEventId: parentId, missingRef: Prisma.DbNull,
            verificationState: "partner_asserted" } });
        else await tx.traceLink.create({ data: { id: randomUUID(), fromEventId: event.id,
          toEventId: parentId, relation: "received_from", verificationState: "partner_asserted" } });
      } else {
        // A relayed public impact keeps C's issuer-qualified source as an
        // explicit graph gap. C is not expected to deliver directly to A, so
        // that third-party reference must not leave the inbox pending forever.
        const assertedExternalImpact = envelope.eventType === "downstream.impact.v1" &&
          envelope.sourceDocument.type === "partner_transfer" &&
          envelope.disclosureScope === "public" &&
          ref.issuerInstanceId !== envelope.issuerInstanceId &&
          ref.issuerInstanceId !== envelope.recipientInstanceId &&
          envelope.sourceEventRefs?.some((source) =>
            source.issuerInstanceId === ref.issuerInstanceId && source.eventId === ref.eventId);
        if (!assertedExternalImpact) missingParent = true;
        if (!existing) await tx.traceLink.create({ data: { id: randomUUID(), fromEventId: event.id,
          missingRef, relation: "received_from", verificationState: "missing" } });
      }
    }
    await tx.passportProjection.updateMany({ where: { batchId: mapping.localBatchId },
      data: { state: "stale" } });
  }
  const state = missingMapping || missingParent ? "pending_dependency" : "applied_to_trace";
  await tx.inboxMessage.update({ where: { id: inbox.id }, data: { state,
    errorCode: missingMapping ? "UNKNOWN_LOT_MAPPING" : missingParent ? "MISSING_UPSTREAM_EVENT" : null,
    appliedAt: state === "applied_to_trace" ? new Date() : null } });
  return state;
}

/** Staff binding uses the issuer-qualified identifiers in a verified inbox, never SKU/name. */
export async function bindExternalLotInTx(tx: Tx, input: { inboxId: string; sourceLineId: string;
  localBatchId: string }, roles: readonly string[]): Promise<string> {
  if (!roles.some((role) => ["administrator", "staff"].includes(role.toLowerCase())))
    throw new MappingError("MAPPING_FORBIDDEN", 403);
  await tx.$queryRaw`SELECT id FROM federation.inbox_message WHERE id = ${input.inboxId}::uuid FOR UPDATE`;
  const inbox = await tx.inboxMessage.findUnique({ where: { id: input.inboxId } });
  if (!inbox || inbox.state === "rejected") throw new MappingError("INBOX_NOT_FOUND", 404);
  const envelope = payloadOf(inbox.payload);
  const lot = envelope.lots.find((candidate) => candidate.sourceLineId === input.sourceLineId);
  if (!lot) throw new MappingError("SOURCE_LINE_NOT_FOUND", 404);
  const batch = await tx.batch.findUnique({ where: { id: input.localBatchId } });
  if (!batch || batch.originIssuerInstanceId !== lot.originLot.issuerInstanceId ||
      batch.originLotId !== lot.originLot.lotId)
    throw new MappingError("LOCAL_BATCH_ORIGIN_MISMATCH");
  const key = { senderInstanceId: lot.senderBatch.instanceId,
    senderBatchId: lot.senderBatch.batchId,
    originIssuerInstanceId: lot.originLot.issuerInstanceId,
    originLotId: lot.originLot.lotId };
  const lockKey = `mapping:${key.senderInstanceId}:${key.senderBatchId}:${key.originIssuerInstanceId}:${key.originLotId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const existing = await tx.identityMapping.findUnique({ where: {
    senderInstanceId_senderBatchId_originIssuerInstanceId_originLotId: key } });
  if (existing) {
    if (existing.localBatchId !== batch.id) throw new MappingError("MAPPING_CONFLICT");
    return existing.id;
  }
  const mapped = await tx.identityMapping.create({ data: { id: randomUUID(), ...key,
    localBatchId: batch.id, sourceMessageId: inbox.id,
    verificationState: "partner_asserted" } });
  await resolveInbox(tx, inbox.id);
  return mapped.id;
}

export async function bindExternalLot(db: PrismaClient, input: { inboxId: string; sourceLineId: string;
  localBatchId: string }, roles: readonly string[]): Promise<string> {
  const mappingId = await db.$transaction((tx) => bindExternalLotInTx(tx, input, roles));
  await resolvePendingDependencies(db);
  return mappingId;
}

/** Recheck pending rows after parent arrival or a completed local mapping. */
export async function resolvePendingDependencies(db: PrismaClient, limit = 100): Promise<number> {
  const rows = await db.inboxMessage.findMany({ where: { state: "pending_dependency" },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: limit,
    select: { id: true } });
  let resolved = 0;
  for (const row of rows) {
    try {
      const state = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM federation.inbox_message WHERE id = ${row.id}::uuid FOR UPDATE`;
        return resolveInbox(tx, row.id);
      });
      if (state === "applied_to_trace") resolved++;
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      await db.inboxMessage.update({ where: { id: row.id },
        data: { state: "rejected", errorCode: error.code } });
      console.warn(JSON.stringify({ service: "federation-resolver", inboxId: row.id,
        outcome: "rejected", code: error.code }));
    }
  }
  return resolved;
}

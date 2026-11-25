// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { Prisma } from "@prisma/client";
import type { FederationEnvelope } from "../../../contracts/events/federation";
import { MappingError } from "./mapping-error";

type Tx = Prisma.TransactionClient;
type EventRef = { issuerInstanceId: string; externalEventId: string };
type MessageRef = { issuerInstanceId: string; messageId: string; eventId: string };
type Item = EventRef & { eventType: string; occurredAt: string; disclosureScope: "partner" | "public";
  policyVersion: number; state: "active" | "revoked"; parents: EventRef[];
  sourceMessageRef?: MessageRef };
export type TraceSummaryEnvelope = FederationEnvelope & { targetLot: {
  originLot: { issuerInstanceId: string; lotId: string };
  senderBatch: { instanceId: string; batchId: string } }; traceSummaries: Item[] };

function checksum(value: object): string {
  const bytes = canonicalize(value);
  if (!bytes || Buffer.byteLength(bytes, "utf8") > 16 * 1024)
    throw new MappingError("TRACE_SUMMARY_TOO_LARGE", 422);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Store only allowlisted partner assertions. Revisions update the policy cache, not immutable provenance. */
export async function applyTraceSummary(tx: Tx, inboxId: string,
  envelope: TraceSummaryEnvelope): Promise<"pending_dependency" | "applied_to_trace"> {
  const { targetLot } = envelope;
  const keys = new Set(envelope.traceSummaries.map((item) =>
    `${item.issuerInstanceId}:${item.externalEventId}`));
  const parents = new Map(envelope.traceSummaries.map((item) => [
    `${item.issuerInstanceId}:${item.externalEventId}`,
    item.parents.map((ref) => `${ref.issuerInstanceId}:${ref.externalEventId}`)]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string) {
    if (visiting.has(key)) throw new MappingError("DEPENDENCY_CYCLE", 422);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const parent of parents.get(key) ?? []) if (keys.has(parent)) visit(parent);
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of keys) visit(key);
  if (targetLot.senderBatch.instanceId !== envelope.issuerInstanceId)
    throw new MappingError("SENDER_BATCH_ISSUER_MISMATCH", 422);
  const mapping = await tx.identityMapping.findUnique({ where: {
    senderInstanceId_senderBatchId_originIssuerInstanceId_originLotId: {
      senderInstanceId: targetLot.senderBatch.instanceId,
      senderBatchId: targetLot.senderBatch.batchId,
      originIssuerInstanceId: targetLot.originLot.issuerInstanceId,
      originLotId: targetLot.originLot.lotId,
    } } });
  if (!mapping) {
    await tx.inboxMessage.update({ where: { id: inboxId },
      data: { state: "pending_dependency", errorCode: "UNKNOWN_LOT_MAPPING" } });
    return "pending_dependency";
  }
  const current = new Map<string, string>();
  for (const item of envelope.traceSummaries) {
    if (item.issuerInstanceId === envelope.recipientInstanceId ||
        (item.sourceMessageRef && item.sourceMessageRef.issuerInstanceId !== item.issuerInstanceId))
      throw new MappingError("TRACE_SOURCE_CONFLICT", 422);
    if (item.issuerInstanceId !== envelope.issuerInstanceId && item.disclosureScope !== "public")
      throw new MappingError("RELAY_NOT_ALLOWED", 422);
    const where = { issuerInstanceId_externalEventId: {
      issuerInstanceId: item.issuerInstanceId, externalEventId: item.externalEventId } };
    const prior = await tx.federatedTraceSummary.findUnique({ where });
    if (prior && prior.batchId !== mapping.localBatchId)
      throw new MappingError("TRACE_SOURCE_CONFLICT", 409);
    if (prior && item.policyVersion < prior.policyVersion)
      throw new MappingError("STALE_POLICY_VERSION", 409);
    if (prior && item.policyVersion === prior.policyVersion &&
        (prior.disclosureScope !== item.disclosureScope ||
          (prior.state !== item.state && !(prior.state === "active" && item.state === "revoked"))))
      throw new MappingError("POLICY_VERSION_CONFLICT", 409);
    const safe = { assertedBy: envelope.issuerInstanceId, originLot: targetLot.originLot,
      sourceMessageRef: item.sourceMessageRef ?? null, disclosureScope: item.disclosureScope,
      policyVersion: item.policyVersion, sourceEventId: item.externalEventId,
      observedAt: envelope.occurredAt };
    if (item.state === "active") {
      const event = await tx.traceEvent.upsert({ where, create: {
        id: randomUUID(), issuerInstanceId: item.issuerInstanceId,
        externalEventId: item.externalEventId, eventType: item.eventType,
        batchId: mapping.localBatchId, sourceMessageId: inboxId,
        originIssuerInstanceId: targetLot.originLot.issuerInstanceId,
        originLotId: targetLot.originLot.lotId, occurredAt: new Date(item.occurredAt),
        verificationState: "partner_asserted", payloadVersion: envelope.schemaVersion,
        summary: safe, checksumHex: checksum(safe),
      }, update: {} });
      if (event.batchId !== mapping.localBatchId ||
          event.originIssuerInstanceId !== targetLot.originLot.issuerInstanceId ||
          event.originLotId !== targetLot.originLot.lotId || event.eventType !== item.eventType)
        throw new MappingError("TRACE_SOURCE_CONFLICT", 409);
      current.set(`${item.issuerInstanceId}:${item.externalEventId}`, event.id);
    }
    await tx.federatedTraceSummary.upsert({ where, create: { id: randomUUID(),
      issuerInstanceId: item.issuerInstanceId, externalEventId: item.externalEventId,
      policyVersion: item.policyVersion, disclosureScope: item.disclosureScope,
      state: item.state, sourceInboxId: inboxId, observedAt: new Date(envelope.occurredAt),
      batchId: mapping.localBatchId }, update: {
      policyVersion: item.policyVersion, disclosureScope: item.disclosureScope,
      state: item.state, sourceInboxId: inboxId, observedAt: new Date(envelope.occurredAt),
      refreshedAt: new Date() } });
  }
  for (const item of envelope.traceSummaries) {
    const fromId = current.get(`${item.issuerInstanceId}:${item.externalEventId}`);
    if (!fromId) continue;
    for (const parent of item.parents) {
      const known = await tx.traceEvent.findUnique({ where: {
        issuerInstanceId_externalEventId: parent },
        select: { id: true, originIssuerInstanceId: true, originLotId: true } });
      const toId = current.get(`${parent.issuerInstanceId}:${parent.externalEventId}`) ??
        (known?.originIssuerInstanceId === targetLot.originLot.issuerInstanceId &&
          known.originLotId === targetLot.originLot.lotId ? known.id : undefined);
      const missingRef = { issuerInstanceId: parent.issuerInstanceId, eventId: parent.externalEventId };
      const exists = await tx.traceLink.findFirst({ where: { fromEventId: fromId,
        relation: "received_from", OR: [
          { missingRef: { equals: missingRef } }, ...(toId ? [{ toEventId: toId }] : [])] } });
      if (!exists) await tx.traceLink.create({ data: { id: randomUUID(), fromEventId: fromId,
        ...(toId ? { toEventId: toId } : { missingRef }), relation: "received_from",
        verificationState: toId ? "partner_asserted" : "missing" } });
      else if (toId && !exists.toEventId) await tx.traceLink.update({ where: { id: exists.id },
        data: { toEventId: toId, missingRef: Prisma.DbNull,
          verificationState: "partner_asserted" } });
    }
  }
  // A transfer received before its upstream summary keeps a gap until this cached
  // event arrives. Resolve only the same origin lot and issuer-qualified message.
  for (const item of envelope.traceSummaries) {
    if (!item.sourceMessageRef || item.state !== "active") continue;
    const targetId = current.get(`${item.issuerInstanceId}:${item.externalEventId}`);
    if (!targetId) continue;
    const rows = await tx.traceLink.findMany({ where: {
      verificationState: "missing",
      missingRef: { equals: { issuerInstanceId: item.sourceMessageRef.issuerInstanceId,
        eventId: item.sourceMessageRef.eventId } },
      fromEvent: { originIssuerInstanceId: targetLot.originLot.issuerInstanceId,
        originLotId: targetLot.originLot.lotId } } });
    for (const row of rows) await tx.traceLink.update({ where: { id: row.id },
      data: { toEventId: targetId, missingRef: Prisma.DbNull,
        verificationState: "partner_asserted" } });
  }
  await tx.passportProjection.updateMany({ where: { batchId: mapping.localBatchId },
    data: { state: "stale" } });
  await tx.inboxMessage.update({ where: { id: inboxId }, data: {
    state: "applied_to_trace", errorCode: null, appliedAt: new Date() } });
  return "applied_to_trace";
}

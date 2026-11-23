// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";
import projectionSchema from "../../../contracts/core-records/trace_projection.schema.json";
import { PermanentDeliveryError } from "../../../platform/outbox/message";
import { localEventId, type TraceProjectorPort, type TraceSource } from "../application/trace-projector";
import { makeLocalTraceEvent } from "../domain/provenance";
import { createTraceRepository } from "./prisma-repos";

const docTypes: Record<string, string> = {
  "trading.receipt.confirmed.v1": "goods_receipt",
  "trading.issue.confirmed.v1": "goods_issue",
  "trading.transfer.confirmed.v1": "partner_transfer",
  "trading.receiving.confirmed.v1": "receiving_confirmation",
  "trading.stocktake.confirmed.v1": "stocktake",
  "trading.sale.recorded.v1": "sale_record",
};
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateProjection = ajv.compile(projectionSchema);
const checksum = (payload: unknown) => createHash("sha256")
  .update(canonicalize(payload)!, "utf8").digest("hex");
const invalid = (code: string): never => { throw new PermanentDeliveryError(code); };

async function append(app: PrismaClient, issuerInstanceId: string, source: TraceSource, outboxId: string) {
  await app.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { id: source.documentId },
      include: { lines: true, receivingDetail: true } });
    if (!document || document.documentType !== docTypes[source.eventType] ||
        document.status !== "confirmed" || document.version !== source.documentVersion) {
      throw new PermanentDeliveryError("TRACE_DOCUMENT_MISMATCH");
    }
    const batch = await tx.batch.findUnique({ where: { id: source.batchId } });
    if (!batch) throw new PermanentDeliveryError("TRACE_BATCH_MISSING");
    const lines = document.lines.filter((line) => line.batchId === source.batchId);
    if (!lines.length || source.lines.length !== lines.length) invalid("TRACE_LINES_MISMATCH");
    for (const item of source.lines) {
      const line = lines.find((row) => source.eventType === "trading.receiving.confirmed.v1"
        ? row.sourceLineRef === item.sourceLineId
        : ["trading.transfer.confirmed.v1", "trading.sale.recorded.v1"].includes(source.eventType)
          ? row.sourceIssueLineId === item.sourceLineId : row.id === item.sourceLineId);
      const quantity = source.eventType === "trading.receiving.confirmed.v1" ? line?.actualQuantity
        : source.eventType === "trading.stocktake.confirmed.v1" ? line?.countedQuantity : line?.quantity;
      if (!line || !quantity || !quantity.eq(new Decimal(item.quantity))) invalid("TRACE_LINES_MISMATCH");
    }
    const eventId = localEventId(source.sourceEventId, source.batchId);
    const summary = { schemaVersion: 1, sourceEventId: source.sourceEventId, sourceOutboxId: outboxId,
      documentVersion: source.documentVersion, lines: source.lines,
      ...(source.linkedIssueId ? { linkedIssueId: source.linkedIssueId } : {}),
      ...(source.remoteSource ? { remoteSource: source.remoteSource } : {}) };
    const input = { issuerInstanceId, externalEventId: eventId, eventType: source.eventType,
      batchId: source.batchId, documentId: source.documentId,
      originIssuerInstanceId: batch.originIssuerInstanceId, originLotId: batch.originLotId,
      occurredAt: source.occurredAt, payloadVersion: "1", summary };
    const repo = createTraceRepository(tx);
    const existing = await repo.findLocalSource(source.documentId, source.batchId, source.eventType);
    const event = existing ?? await repo.appendLocalEvent(input);
    if (existing && (existing.externalEventId !== eventId ||
        existing.checksumHex !== makeLocalTraceEvent(input).checksumHex)) invalid("TRACE_REPLAY_CONFLICT");
    if (source.linkedIssueId) {
      const upstream = await repo.findLocalSource(source.linkedIssueId, source.batchId,
        "trading.issue.confirmed.v1");
      if (!upstream) throw new Error("TRACE_SOURCE_PENDING");
      await tx.traceLink.createMany({ data: [{ id: randomUUID(), fromEventId: event.id,
        toEventId: upstream.id, relation: "derived_from", verificationState: "local_verified" }],
        skipDuplicates: true });
    }
    if (source.remoteSource) {
      const inboundId = document.receivingDetail?.inboundMessageId;
      const inbound = inboundId ? await tx.inboundMessage.findUnique({ where: { messageId: inboundId } }) : null;
      const payload = inbound?.payload as { eventId?: unknown; issuerInstanceId?: unknown;
        sourceDocument?: { id?: unknown } } | undefined;
      if (!payload || payload.issuerInstanceId !== source.remoteSource.issuerInstanceId ||
          payload.sourceDocument?.id !== source.remoteSource.transferId ||
          typeof payload.eventId !== "string") throw new PermanentDeliveryError("TRACE_REMOTE_SOURCE_INVALID");
      await tx.traceLink.createMany({ data: [{ id: randomUUID(), fromEventId: event.id,
        missingRef: { issuerInstanceId: source.remoteSource.issuerInstanceId, eventId: payload.eventId },
        relation: "received_from", verificationState: "missing" }], skipDuplicates: true });
    }
  });
}

async function rebuild(app: PrismaClient, core: PrismaClient, batchId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // Re-read the append-only source on every CAS attempt. A concurrent projector
    // may have committed another event between our previous read and core write.
    const batch = await app.batch.findUniqueOrThrow({ where: { id: batchId } });
    const events = await app.traceEvent.findMany({ where: { batchId },
      include: { outgoing: true }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    if (!events.length) return;
    const sourceEventIds = events.map((event) => event.id);
    const nodes = events.map((event) => ({ eventId: event.id, issuerInstanceId: event.issuerInstanceId,
      type: event.eventType, occurredAt: event.occurredAt.toISOString(),
      verificationState: event.verificationState }));
    const edges = events.flatMap((event) => event.outgoing.map((link) => ({
      fromEventId: event.id, relation: link.relation,
      ...(link.toEventId ? { toEventId: link.toEventId }
        : { missingRef: link.missingRef as { issuerInstanceId: string; eventId: string } }),
    }))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const asOf = new Date(Math.max(...events.map((event) => event.createdAt.getTime()))).toISOString();
    const payload = { schemaVersion: 1,
      originLot: { issuerInstanceId: batch.originIssuerInstanceId, lotId: batch.originLotId },
      sourceEventIds, nodes, edges, transformVersion: "p08-t02-v1", asOf };
    if (!validateProjection(payload)) invalid("TRACE_PROJECTION_INVALID");
    const checksumHex = checksum(payload);
    const existing = await core.coreRecord.findUnique({ where: { kind_sourceType_sourceId: {
      kind: "trace_projection", sourceType: "lot", sourceId: batchId } } });
    if (existing?.checksumHex === checksumHex) return;
    if (existing) {
      const prior = existing.payload as { sourceEventIds?: unknown; edges?: unknown };
      const ids = Array.isArray(prior.sourceEventIds) ? prior.sourceEventIds : [];
      const priorEdges = Array.isArray(prior.edges) ? prior.edges : [];
      const edgeKeys = new Set(edges.map((edge) => canonicalize(edge)));
      if (ids.some((id) => !sourceEventIds.includes(String(id))) ||
          priorEdges.some((edge) => !edgeKeys.has(canonicalize(edge)))) continue;
      const updated = await core.coreRecord.updateMany({ where: { id: existing.id, version: existing.version },
        data: { payload: payload as Prisma.InputJsonValue, checksumHex, builtAt: new Date(asOf),
          version: { increment: 1 }, updatedAt: new Date() } });
      if (updated.count === 1) return;
    } else {
      try {
        await core.coreRecord.create({ data: { id: randomUUID(), kind: "trace_projection",
          sourceType: "lot", sourceId: batchId, payload: payload as Prisma.InputJsonValue,
          visibility: "private", policyVersion: "v1", checksumHex, builtAt: new Date(asOf) } });
        return;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "P2002")) throw error;
      }
    }
  }
  throw new Error("TRACE_PROJECTION_VERSION_CONFLICT");
}

export function createPrismaTraceProjectorPort(app: PrismaClient, core: PrismaClient,
  issuerInstanceId: string): TraceProjectorPort {
  if (!issuerInstanceId.trim()) throw new Error("NEXORA_ISSUER_INSTANCE_ID is required");
  return { append: (source, outboxId) => append(app, issuerInstanceId, source, outboxId),
    rebuild: (batchId) => rebuild(app, core, batchId) };
}

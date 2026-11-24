// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";
import { Decimal } from "@prisma/client/runtime/library";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { prismaAuditRecorder } from "../../../platform/audit/prisma-audit-recorder";
import { DomainError } from "../../../platform/kernel/errors";
import { buildPassportPayload, canPublishPassport, parsePassportAccess,
  type PassportAccess } from "./passport-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tx = Prisma.TransactionClient;
const hash = (value: unknown) => createHash("sha256").update(canonicalize(value)!, "utf8")
  .digest("hex");

function authorize(actor: Actor, batchId: string) {
  if (!checkPolicy(actor, "trace:passport-policy:manage").allowed)
    throw new DomainError("POLICY_DENIED", 403);
  if (!UUID.test(batchId)) throw new DomainError("BATCH_NOT_FOUND", 404);
}

async function batchOrThrow(tx: Tx, batchId: string) {
  const batch = await tx.batch.findUnique({ where: { id: batchId },
    include: { product: { select: { name: true } } } });
  if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);
  return batch;
}

function accessOf(row: { organizationVisibility: string; productVisibility: string;
  batchVisibility: string; timelineVisibility: string; evidenceVisibility: string }) {
  return parsePassportAccess({ organization: row.organizationVisibility,
    product: row.productVisibility, batch: row.batchVisibility,
    timeline: row.timelineVisibility, evidence: row.evidenceVisibility });
}

async function project(tx: Tx, batchId: string, policyVersion: number,
  access: PassportAccess, approvedAt: Date) {
  const batch = await batchOrThrow(tx, batchId);
  const events = await tx.traceEvent.findMany({ where: { batchId },
    include: { outgoing: { select: { toEventId: true, missingRef: true } },
      document: { include: { lines: true } },
      evidence: { include: { attachment: { select: { scanState: true, bucket: true,
        sha256Hex: true } } }, orderBy: { id: "asc" } } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
  const sourceDocuments = await tx.documentLine.findMany({ where: { batchId },
    select: { documentId: true }, distinct: ["documentId"] });
  const pending = sourceDocuments.length ? await tx.outboxMessage.count({ where: {
    aggregateId: { in: sourceDocuments.map((row) => row.documentId) },
    destination: "traceability", status: { not: "delivered" },
  } }) : 0;
  const publish = batch.qualityStatus === "available" && canPublishPassport(access);
  const result = publish ? buildPassportPayload(access, {
    productName: batch.product.name, publicLotCode: batch.localCode,
    originIssuer: batch.originIssuerInstanceId, approvedAt,
    projectionPending: pending > 0,
    events: events.map((event) => {
      const lines = event.document?.lines.filter((line) => line.batchId === batchId) ?? [];
      const summary = event.summary as { documentVersion?: unknown;
        lines?: { sourceLineId?: unknown; quantity?: unknown }[] };
      const sourceLines = Array.isArray(summary.lines) ? summary.lines : [];
      const receiving = event.eventType === "trading.receiving.confirmed.v1";
      const quantitiesMatch = sourceLines.length === lines.length && lines.every((line) => {
        const ref = receiving ? line.sourceLineRef :
          ["trading.transfer.confirmed.v1", "trading.sale.recorded.v1"].includes(event.eventType)
            ? line.sourceIssueLineId : line.id;
        const source = sourceLines.find((item) => item && item.sourceLineId === ref);
        const actual = receiving ? line.actualQuantity :
          event.eventType === "trading.stocktake.confirmed.v1" ? line.countedQuantity : line.quantity;
        if (!source || !actual || typeof source.quantity !== "string" ||
            !/^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(source.quantity)) return false;
        return new Decimal(source.quantity).eq(actual);
      });
      const sameUnit = new Set(lines.map((line) => line.uomId)).size <= 1;
      const sentQuantity = receiving && sameUnit && lines.every((line) => line.quantity)
        ? lines.reduce((sum, line) => sum.add(line.quantity!), new Decimal(0)).toFixed(3)
        : undefined;
      const actualQuantity = receiving && sameUnit && lines.every((line) => line.actualQuantity)
        ? lines.reduce((sum, line) => sum.add(line.actualQuantity!), new Decimal(0)).toFixed(3)
        : undefined;
      return { id: event.id, type: event.eventType,
        occurredAt: event.occurredAt, recordedAt: event.createdAt,
        issuer: event.issuerInstanceId, sourceId: event.externalEventId,
        verificationState: event.verificationState,
        confirmed: event.document?.status === "confirmed",
        checksumValid: hash({ summary: event.summary, evidenceRefs: event.evidenceRefs }) ===
          event.checksumHex && summary.documentVersion === event.document?.version &&
          quantitiesMatch && (!receiving || sameUnit),
        ...(sentQuantity !== undefined ? { sentQuantity } : {}),
        ...(actualQuantity !== undefined ? { actualQuantity } : {}),
        evidence: event.evidence.map((link) => ({ id: link.id, checksum: link.checksumHex,
          visibility: link.visibility, state: link.state,
          scanState: link.attachment.scanState, bucket: link.attachment.bucket,
          fileChecksum: link.attachment.sha256Hex })),
        links: event.outgoing };
    }),
  }) : { payload: {}, sourceEventIds: [] as string[] };
  const state = !publish ? "revoked" : pending > 0 ? "stale" : "active";
  const now = new Date();
  const data = { publicPayload: result.payload, sourceEventIds: result.sourceEventIds,
    policyVersion: `v${policyVersion}`, builtAt: now, state, checksumHex: hash(result.payload),
    updatedAt: now };
  await tx.passportProjection.upsert({ where: { batchId },
    create: { id: randomUUID(), batchId, ...data },
    update: { ...data, version: { increment: 1 } } });
  return state;
}

export function createPassportService(db: PrismaClient) {
  return {
    async read(actor: Actor, batchId: string) {
      authorize(actor, batchId);
      if (!await db.batch.findUnique({ where: { id: batchId }, select: { id: true } }))
        throw new DomainError("BATCH_NOT_FOUND", 404);
      const policies = await db.passportPolicy.findMany({ where: { batchId },
        orderBy: { policyVersion: "desc" }, take: 20 });
      const projection = await db.passportProjection.findUnique({ where: { batchId },
        select: { state: true, policyVersion: true, builtAt: true, version: true } });
      return { policies, projection };
    },
    async createDraft(actor: Actor, batchId: string, input: unknown, requestId: string) {
      authorize(actor, batchId);
      const access = parsePassportAccess(input);
      return db.$transaction(async (tx) => {
        await batchOrThrow(tx, batchId);
        const latest = await tx.passportPolicy.findFirst({ where: { batchId },
          orderBy: { policyVersion: "desc" } });
        if (latest?.state === "draft") throw new DomainError("PASSPORT_DRAFT_EXISTS", 409);
        const policy = await tx.passportPolicy.create({ data: {
          id: randomUUID(), batchId, policyVersion: (latest?.policyVersion ?? 0) + 1,
          state: "draft", organizationVisibility: access.organization,
          productVisibility: access.product, batchVisibility: access.batch,
          timelineVisibility: access.timeline, evidenceVisibility: access.evidence,
          createdBySub: actor.userId,
        } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.policy.draft", targetType: "passport_policy",
          targetId: policy.id, requestId,
          after: { status: "draft", version: policy.policyVersion,
            changedFields: ["visibility", "policyVersion"] } });
        return policy;
      }, { isolationLevel: "Serializable" });
    },
    async approve(actor: Actor, batchId: string, version: number, requestId: string) {
      authorize(actor, batchId);
      if (!Number.isSafeInteger(version) || version < 1)
        throw new DomainError("PASSPORT_POLICY_INVALID", 422);
      return db.$transaction(async (tx) => {
        const policy = await tx.passportPolicy.findUnique({ where: {
          batchId_policyVersion: { batchId, policyVersion: version } } });
        if (!policy || policy.state !== "draft") throw new DomainError("PASSPORT_DRAFT_NOT_FOUND", 404);
        const previous = await tx.passportPolicy.findFirst({ where: { batchId, state: "approved" } });
        const now = new Date();
        if (previous) await tx.passportPolicy.update({ where: { id: previous.id }, data: {
          state: "revoked", revokedBySub: actor.userId, revokedAt: now } });
        const approved = await tx.passportPolicy.update({ where: { id: policy.id }, data: {
          state: "approved", approvedBySub: actor.userId, approvedAt: now } });
        const state = await project(tx, batchId, version, accessOf(approved), now);
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.policy.approve", targetType: "passport_policy",
          targetId: approved.id, requestId,
          before: { status: "draft", version },
          after: { status: "approved", version, changedFields: ["status", "policyVersion"] } });
        return { policy: approved, projectionState: state };
      }, { isolationLevel: "Serializable" });
    },
    async revoke(actor: Actor, batchId: string, reason: string, requestId: string) {
      authorize(actor, batchId);
      if (!reason.trim() || reason.length > 200) throw new DomainError("REASON_REQUIRED", 422);
      return db.$transaction(async (tx) => {
        const policy = await tx.passportPolicy.findFirst({ where: { batchId, state: "approved" } });
        if (!policy) throw new DomainError("PASSPORT_POLICY_NOT_ACTIVE", 409);
        const now = new Date();
        await tx.passportPolicy.update({ where: { id: policy.id }, data: {
          state: "revoked", revokedBySub: actor.userId, revokedAt: now } });
        await tx.passportProjection.updateMany({ where: { batchId }, data: {
          state: "revoked", version: { increment: 1 }, updatedAt: now } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.policy.revoke", targetType: "passport_policy",
          targetId: policy.id, requestId,
          before: { status: "approved", version: policy.policyVersion },
          after: { status: "revoked", version: policy.policyVersion, reason,
            changedFields: ["status"] } });
        return { state: "revoked" as const };
      }, { isolationLevel: "Serializable" });
    },
    async rebuild(actor: Actor, batchId: string, requestId: string) {
      authorize(actor, batchId);
      return db.$transaction(async (tx) => {
        const policy = await tx.passportPolicy.findFirst({ where: { batchId, state: "approved" } });
        if (!policy || !policy.approvedAt) throw new DomainError("PASSPORT_POLICY_NOT_ACTIVE", 409);
        const state = await project(tx, batchId, policy.policyVersion,
          accessOf(policy), policy.approvedAt);
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.projection.rebuild", targetType: "passport_policy",
          targetId: policy.id, requestId,
          after: { status: state, version: policy.policyVersion } });
        return { state, policyVersion: `v${policy.policyVersion}` };
      }, { isolationLevel: "Serializable" });
    },
  };
}

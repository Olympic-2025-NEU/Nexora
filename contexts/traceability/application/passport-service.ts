// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";
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
      document: { select: { status: true } } },
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
    events: events.map((event) => ({ id: event.id, type: event.eventType,
      occurredAt: event.occurredAt, recordedAt: event.createdAt,
      verificationState: event.verificationState,
      confirmed: event.document?.status === "confirmed",
      links: event.outgoing })),
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

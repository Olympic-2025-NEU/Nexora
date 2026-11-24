// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { prismaAuditRecorder } from "../../../platform/audit/prisma-audit-recorder";
import { DomainError } from "../../../platform/kernel/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBILITIES = new Set(["private", "partner", "public"]);

export function createTraceEvidenceService(db: PrismaClient) {
  async function scoped(actor: Actor, batchId: string, manage: boolean) {
    if (!checkPolicy(actor, manage ? "trace:evidence:manage" : "trace:read").allowed)
      throw new DomainError("POLICY_DENIED", 403);
    if (!UUID.test(batchId)) throw new DomainError("BATCH_NOT_FOUND", 404);
    if (actor.roles.includes("administrator")) return;
    if (!actor.unitIds.length || !await db.documentLine.findFirst({ where: {
      batchId, warehouseId: { in: [...actor.unitIds] }, document: { status: "confirmed" } },
      select: { id: true } })) throw new DomainError("BATCH_NOT_FOUND", 404);
  }
  return {
    async attach(actor: Actor, batchId: string, eventId: string, attachmentId: string,
      visibility: string, requestId: string) {
      await scoped(actor, batchId, true);
      if (!UUID.test(eventId) || !UUID.test(attachmentId) || !VISIBILITIES.has(visibility))
        throw new DomainError("TRACE_EVIDENCE_INVALID", 422);
      if (visibility === "public" && !actor.roles.includes("administrator"))
        throw new DomainError("POLICY_DENIED", 403);
      return db.$transaction(async (tx) => {
        const event = await tx.traceEvent.findFirst({ where: { id: eventId, batchId,
          verificationState: "local_verified", document: { status: "confirmed",
            ...(!actor.roles.includes("administrator") ? { lines: { some: {
              batchId, warehouseId: { in: [...actor.unitIds] } } } } : {}) } },
          select: { documentId: true } });
        if (!event?.documentId) throw new DomainError("TRACE_EVENT_NOT_FOUND", 404);
        const file = await tx.attachment.findUnique({ where: { id: attachmentId } });
        if (!file || (!actor.roles.includes("administrator") && file.createdBySub !== actor.userId))
          throw new DomainError("FILE_NOT_FOUND", 404);
        if (file.scanState !== "clean" || file.bucket !== "private" ||
            file.visibility !== "private" || file.ownerType !== "core_record" || file.ownerId ||
            !file.scannedAt || !file.scanEngineVersion)
          throw new DomainError("FILE_NOT_CLEAN", 423);
        if (visibility === "public") {
          const policy = await tx.passportPolicy.findFirst({ where: { batchId,
            state: "approved", evidenceVisibility: "public", timelineVisibility: "public" },
            select: { id: true } });
          if (!policy) throw new DomainError("EVIDENCE_NOT_PUBLIC", 409);
        }
        if (await tx.traceEvidence.findUnique({ where: {
          eventId_attachmentId: { eventId, attachmentId } }, select: { id: true } }))
          throw new DomainError("TRACE_EVIDENCE_EXISTS", 409);
        const link = await tx.traceEvidence.create({ data: { id: randomUUID(), eventId,
          documentId: event.documentId, attachmentId, checksumHex: file.sha256Hex,
          visibility, state: "active", createdBySub: actor.userId } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "trace.evidence.attach", targetType: "trace_evidence", targetId: link.id,
          requestId, after: { status: "active", visibility, changedFields: ["status", "visibility"] } });
        return { id: link.id, eventId, attachmentId, checksum: file.sha256Hex,
          visibility, state: link.state };
      }, { isolationLevel: "Serializable" });
    },
    async list(actor: Actor, batchId: string) {
      await scoped(actor, batchId, false);
      return db.traceEvidence.findMany({ where: { event: { batchId,
        ...(!actor.roles.includes("administrator") ? { document: { lines: { some: {
          batchId, warehouseId: { in: [...actor.unitIds] } } } } } : {}) } },
        select: { id: true, eventId: true, documentId: true, attachmentId: true,
          checksumHex: true, visibility: true, state: true, createdAt: true,
          attachment: { select: { scanState: true, mimeType: true } } },
        orderBy: { createdAt: "desc" }, take: 100 });
    },
    async revoke(actor: Actor, batchId: string, evidenceId: string, reason: string,
      requestId: string) {
      await scoped(actor, batchId, true);
      if (!UUID.test(evidenceId) || typeof reason !== "string" || !reason.trim() || reason.length > 200)
        throw new DomainError("TRACE_EVIDENCE_INVALID", 422);
      await db.$transaction(async (tx) => {
        const row = await tx.traceEvidence.findFirst({ where: { id: evidenceId,
          event: { batchId,
            ...(!actor.roles.includes("administrator") ? { document: { lines: { some: {
              batchId, warehouseId: { in: [...actor.unitIds] } } } } } : {}) } } });
        if (!row) throw new DomainError("TRACE_EVIDENCE_NOT_FOUND", 404);
        if (row.visibility === "public" && !actor.roles.includes("administrator"))
          throw new DomainError("POLICY_DENIED", 403);
        if (row.state === "revoked") return;
        await tx.traceEvidence.update({ where: { id: row.id }, data: {
          state: "revoked", revokedAt: new Date() } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "trace.evidence.revoke", targetType: "trace_evidence", targetId: row.id,
          requestId, before: { status: "active", visibility: row.visibility },
          after: { status: "revoked", reason, changedFields: ["status"] } });
      }, { isolationLevel: "Serializable" });
    },
  };
}

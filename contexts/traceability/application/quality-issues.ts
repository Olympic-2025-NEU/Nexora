// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "@/platform/kernel/errors";

const POLICY = "p12-t04-v1";

export type QualityRuleId =
  | "missing_source"
  | "out_of_order"
  | "conflicting_quantity"
  | "unscanned_evidence"
  | "unknown_issuer"
  | "stale_partner_summary";

const SEVERITY: Record<QualityRuleId, "info" | "warning" | "critical"> = {
  missing_source: "warning",
  out_of_order: "info",
  conflicting_quantity: "critical",
  unscanned_evidence: "critical",
  unknown_issuer: "critical",
  stale_partner_summary: "warning",
};

const SOURCE_TYPE: Record<QualityRuleId, "lot" | "event" | "attachment" | "partner"> = {
  missing_source: "lot",
  out_of_order: "event",
  conflicting_quantity: "event",
  unscanned_evidence: "attachment",
  unknown_issuer: "partner",
  stale_partner_summary: "partner",
};

export async function upsertQualityIssue(
  db: PrismaClient,
  input: {
    ruleId: QualityRuleId;
    sourceId: string;
    reason: string;
    sourceEventIds?: string[];
    expected?: string;
    actual?: string;
  },
) {
  const now = new Date();
  const sourceType = SOURCE_TYPE[input.ruleId];
  const existing = await db.qualityIssue.findUnique({
    where: {
      ruleId_sourceType_sourceId: {
        ruleId: input.ruleId,
        sourceType,
        sourceId: input.sourceId,
      },
    },
  });
  const detail = {
    schemaVersion: 1,
    reason: input.reason,
    ...(input.expected ? { expected: input.expected } : {}),
    ...(input.actual ? { actual: input.actual } : {}),
  };
  if (!existing) {
    return db.qualityIssue.create({
      data: {
        id: randomUUID(),
        ruleId: input.ruleId,
        sourceType,
        sourceId: input.sourceId,
        state: "open",
        severity: SEVERITY[input.ruleId],
        sourceEventIds: input.sourceEventIds ?? [],
        detail: detail as Prisma.InputJsonValue,
        policyVersion: POLICY,
        firstDetectedAt: now,
        lastDetectedAt: now,
      },
    });
  }
  return db.qualityIssue.update({
    where: { id: existing.id },
    data: {
      lastDetectedAt: now,
      updatedAt: now,
      version: { increment: 1 },
      detail: detail as Prisma.InputJsonValue,
      sourceEventIds: input.sourceEventIds ?? existing.sourceEventIds,
      ...(existing.state === "resolved"
        ? { state: "open", resolvedAt: null, resolvedBySub: null }
        : {}),
    },
  });
}

export async function listQualityIssues(
  db: PrismaClient,
  filter: { state?: string; severity?: string; ruleId?: string; limit?: number },
) {
  return db.qualityIssue.findMany({
    where: {
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.ruleId ? { ruleId: filter.ruleId } : {}),
    },
    orderBy: [{ lastDetectedAt: "desc" }],
    take: Math.min(filter.limit ?? 50, 100),
  });
}

export async function getQualityIssue(db: PrismaClient, id: string) {
  const row = await db.qualityIssue.findUnique({ where: { id } });
  if (!row) throw new DomainError("QUALITY_ISSUE_NOT_FOUND", 404);
  return row;
}

export async function acknowledgeQualityIssue(
  db: PrismaClient,
  id: string,
  version: number,
  reason: string,
  actorSub: string,
  requestId = randomUUID(),
) {
  if (!reason.trim()) throw new DomainError("QUALITY_REASON_REQUIRED", 422);
  const row = await getQualityIssue(db, id);
  if (row.version !== version || row.state !== "open") throw new DomainError("VERSION_CONFLICT", 409);
  const updated = await db.qualityIssue.update({
    where: { id },
    data: {
      state: "acknowledged",
      version: { increment: 1 },
      updatedAt: new Date(),
      detail: {
        ...(row.detail as object),
        ackReason: reason.trim(),
        ackBy: actorSub,
      } as Prisma.InputJsonValue,
    },
  });
  await db.auditLog.create({
    data: {
      id: randomUUID(),
      actorSub,
      action: "quality.issue.acknowledge",
      targetType: "quality_issue",
      targetId: id,
      outcome: "success",
      requestId,
      beforeSummary: { status: row.state, version: row.version },
      afterSummary: { status: updated.state, version: updated.version, reason: reason.trim().slice(0, 200) },
    },
  });
  return updated;
}

export async function resolveQualityIssue(
  db: PrismaClient,
  id: string,
  version: number,
  reason: string,
  actorSub: string,
  requestId = randomUUID(),
) {
  if (!reason.trim()) throw new DomainError("QUALITY_REASON_REQUIRED", 422);
  const row = await getQualityIssue(db, id);
  if (row.version !== version || !["open", "acknowledged"].includes(row.state)) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }
  const now = new Date();
  const updated = await db.qualityIssue.update({
    where: { id },
    data: {
      state: "resolved",
      version: { increment: 1 },
      updatedAt: now,
      resolvedAt: now,
      resolvedBySub: actorSub,
      detail: {
        ...(row.detail as object),
        resolveReason: reason.trim(),
      } as Prisma.InputJsonValue,
    },
  });
  await db.auditLog.create({
    data: {
      id: randomUUID(),
      actorSub,
      action: "quality.issue.resolve",
      targetType: "quality_issue",
      targetId: id,
      outcome: "success",
      requestId,
      beforeSummary: { status: row.state, version: row.version },
      afterSummary: { status: updated.state, version: updated.version, reason: reason.trim().slice(0, 200) },
    },
  });
  return updated;
}

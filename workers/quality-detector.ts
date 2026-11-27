// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

const POLICY = "p12-t04-v1";

type RuleId =
  | "missing_source"
  | "out_of_order"
  | "conflicting_quantity"
  | "unscanned_evidence"
  | "unknown_issuer"
  | "stale_partner_summary";

const SEVERITY: Record<RuleId, "info" | "warning" | "critical"> = {
  missing_source: "warning",
  out_of_order: "info",
  conflicting_quantity: "critical",
  unscanned_evidence: "critical",
  unknown_issuer: "critical",
  stale_partner_summary: "warning",
};

const SOURCE_TYPE: Record<RuleId, "lot" | "event" | "attachment" | "partner"> = {
  missing_source: "lot",
  out_of_order: "event",
  conflicting_quantity: "event",
  unscanned_evidence: "attachment",
  unknown_issuer: "partner",
  stale_partner_summary: "partner",
};

async function upsert(
  db: PrismaClient,
  ruleId: RuleId,
  sourceId: string,
  detail: Record<string, string>,
  sourceEventIds: string[] = [],
) {
  const now = new Date();
  const sourceType = SOURCE_TYPE[ruleId];
  const existing = await db.qualityIssue.findUnique({
    where: { ruleId_sourceType_sourceId: { ruleId, sourceType, sourceId } },
  });
  const payload = { schemaVersion: 1, ...detail } as Prisma.InputJsonValue;
  if (!existing) {
    await db.qualityIssue.create({
      data: {
        id: randomUUID(),
        ruleId,
        sourceType,
        sourceId,
        state: "open",
        severity: SEVERITY[ruleId],
        sourceEventIds,
        detail: payload,
        policyVersion: POLICY,
        firstDetectedAt: now,
        lastDetectedAt: now,
      },
    });
    return;
  }
  await db.qualityIssue.update({
    where: { id: existing.id },
    data: {
      lastDetectedAt: now,
      updatedAt: now,
      version: { increment: 1 },
      detail: payload,
      sourceEventIds: sourceEventIds.length ? sourceEventIds : existing.sourceEventIds,
      ...(existing.state === "resolved"
        ? { state: "open", resolvedAt: null, resolvedBySub: null }
        : {}),
    },
  });
}

/** Demo clock detectors for all six quality_issue rule IDs. Never mutates stock/quality. */
export async function detectQualityIssues(db: PrismaClient): Promise<number> {
  let count = 0;
  const fiveMin = new Date(Date.now() - 5 * 60_000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);

  const links = await db.traceLink.findMany({
    where: { missingRef: { not: Prisma.DbNull }, createdAt: { lte: fiveMin } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  for (const link of links) {
    await upsert(db, "missing_source", link.id, {
      reason: "trace_link.missing_ref unresolved >5m",
    }, [link.fromEventId]);
    count += 1;
  }

  const pending = await db.inboxMessage.findMany({
    where: { state: "pending_dependency", receivedAt: { lte: fiveMin } },
    take: 50,
    orderBy: { receivedAt: "asc" },
  });
  for (const msg of pending) {
    await upsert(db, "out_of_order", msg.eventId, {
      reason: "inbox pending_dependency >5m",
      expected: "parent_before_child",
      actual: msg.state,
    }, [msg.eventId].filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
    count += 1;
  }

  const receipts = await db.businessReceipt.findMany({
    take: 100,
    orderBy: { receivedAt: "asc" },
  });
  for (const receipt of receipts) {
    if (Number(receipt.discrepancyQuantity) === 0) continue;
    await upsert(db, "conflicting_quantity", receipt.id, {
      reason: "business_receipt discrepancy",
      expected: String(receipt.sentQuantity),
      actual: String(receipt.actualQuantity),
    });
    count += 1;
  }

  const evidence = await db.traceEvidence.findMany({
    where: { state: "active", attachment: { scanState: { not: "clean" } } },
    take: 50,
    include: { attachment: { select: { id: true, scanState: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const row of evidence) {
    await upsert(db, "unscanned_evidence", row.attachmentId, {
      reason: "trace_evidence references non-clean attachment",
      actual: row.attachment.scanState,
      expected: "clean",
    }, [row.eventId]);
    count += 1;
  }

  const badAuth = await db.auditLog.findMany({
    where: {
      action: { in: ["auth.m2m.reject", "federation.unknown_issuer"] },
      createdAt: { gte: dayAgo },
    },
    take: 50,
    orderBy: { createdAt: "desc" },
  });
  const seenClients = new Set<string>();
  for (const row of badAuth) {
    const raw = row.clientId ?? row.targetId;
    if (!raw || seenClients.has(raw)) continue;
    seenClients.add(raw);
    const redacted = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    await upsert(db, "unknown_issuer", redacted, {
      reason: "m2m client not mapped to active partner",
    });
    count += 1;
  }

  const partners = await db.partner.findMany({
    where: { status: "active" },
    take: 100,
    select: { id: true, inboxMessages: { orderBy: { receivedAt: "desc" }, take: 1, select: { receivedAt: true } } },
  });
  for (const partner of partners) {
    const last = partner.inboxMessages[0]?.receivedAt;
    if (last && last > dayAgo) continue;
    await upsert(db, "stale_partner_summary", partner.id, {
      reason: "no valid partner event >24h (demo clock)",
      actual: last?.toISOString() ?? "never",
    });
    count += 1;
  }

  return count;
}

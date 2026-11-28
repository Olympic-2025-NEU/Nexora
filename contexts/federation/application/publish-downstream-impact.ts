// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { DomainError } from "../../../platform/kernel/errors";
import { prismaAuditRecorder } from "../../../platform/audit/prisma-audit-recorder";
import { validateFederationEnvelope } from "../../../contracts/events/federation";

type Ref = { issuerInstanceId: string; messageId: string; eventId: string };
type Impact = { originLot: { issuerInstanceId: string; lotId: string };
  disclosureScope: "partner" | "public"; lots: Array<{ quantity: string; unit: string;
    senderBatch: { instanceId: string; batchId: string } }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const units = { count: "EA", mass: "KG", volume: "L" } as const;

/** A local sale starts C→B; a public asserted impact may be relayed B→A. */
export async function publishDownstreamImpact(db: PrismaClient, actor: Actor,
  batchId: string, recipientInstanceId: string, sourceDocumentId: string,
  sourceInboxMessageId: string | undefined, requestId: string) {
  if (!checkPolicy(actor, "trace:federation:publish").allowed)
    throw new DomainError("POLICY_DENIED", 403);
  if (![batchId, sourceDocumentId].every((id) => UUID.test(id)) ||
      (sourceInboxMessageId && !UUID.test(sourceInboxMessageId)) ||
      !recipientInstanceId || recipientInstanceId.length > 64)
    throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422);
  const issuerInstanceId = process.env.NEXORA_ISSUER_INSTANCE_ID;
  if (!issuerInstanceId) throw new DomainError("INSTANCE_NOT_CONFIGURED", 503);
  return db.$transaction(async (tx) => {
    const [batch, connection, policy, document] = await Promise.all([
      tx.batch.findUnique({ where: { id: batchId } }),
      tx.partnerConnection.findFirst({ where: { partner: { issuerInstanceId: recipientInstanceId } },
        include: { partner: true } }),
      tx.passportPolicy.findFirst({ where: { batchId, state: "approved" },
        orderBy: { policyVersion: "desc" } }),
      tx.document.findUnique({ where: { id: sourceDocumentId },
        include: { lines: { include: { uom: true } } } }),
    ]);
    if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);
    if (!connection || connection.status !== "active" || connection.partner.status !== "active")
      throw new DomainError("PARTNER_CONNECTION_INACTIVE", 409);
    if (!policy || !["partner", "public"].includes(policy.timelineVisibility))
      throw new DomainError("TRACE_SHARE_POLICY_REQUIRED", 409);
    if (!document || document.status !== "confirmed" ||
        !["sale_record", "partner_transfer"].includes(document.documentType))
      throw new DomainError("SOURCE_DOCUMENT_NOT_CONFIRMED", 409);
    const lines = document.lines.filter((line) => line.batchId === batchId);
    if (!lines.length || lines.length > 100) throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422);
    let refs: Ref[];
    let sourceEventRefs: Array<{ issuerInstanceId: string; eventId: string }>;
    let downstreamPartnerRef: string;
    let impactType: string;
    let impactQuantities: string[];
    if (document.documentType === "sale_record" && !sourceInboxMessageId) {
      const mapping = await tx.identityMapping.findFirst({ where: {
        localBatchId: batchId, senderInstanceId: recipientInstanceId,
        originIssuerInstanceId: batch.originIssuerInstanceId,
        originLotId: batch.originLotId }, orderBy: { createdAt: "desc" },
        include: { sourceMessage: true } });
      if (!mapping || mapping.sourceMessage.eventType !== "transfer.announced.v1")
        throw new DomainError("UPSTREAM_TRANSFER_NOT_FOUND", 409);
      refs = [{ issuerInstanceId: mapping.sourceMessage.issuerInstanceId,
        messageId: mapping.sourceMessage.messageId, eventId: mapping.sourceMessage.eventId }];
      sourceEventRefs = [{ issuerInstanceId: recipientInstanceId,
        eventId: mapping.sourceMessage.eventId }];
      downstreamPartnerRef = "consumer";
      impactType = "sale";
      impactQuantities = lines.map((line) => line.quantity?.toFixed() ?? "0");
    } else if (document.documentType === "partner_transfer" && sourceInboxMessageId) {
      const inbound = await tx.inboxMessage.findMany({ where: {
        messageId: sourceInboxMessageId, eventType: "downstream.impact.v1" }, take: 2 });
      const actual = inbound.length === 1 ? inbound[0] : null;
      const impact = actual?.payload as Impact | undefined;
      if (!actual || actual.state !== "applied_to_trace" ||
          actual.eventType !== "downstream.impact.v1" ||
          lines.length !== 1 ||
          impact?.disclosureScope !== "public" ||
          impact.originLot.issuerInstanceId !== batch.originIssuerInstanceId ||
          impact.originLot.lotId !== batch.originLotId || impact.lots.length !== 1)
        throw new DomainError("IMPACT_RELAY_NOT_ALLOWED", 409);
      const business = await tx.businessReceiptLine.findFirst({ where: {
        sourceLineId: lines[0]!.id,
        receiverBatchId: impact.lots[0]!.senderBatch.batchId,
        receipt: { issuerInstanceId: actual.issuerInstanceId } } });
      if (!business) throw new DomainError("IMPACT_RELAY_SOURCE_MISMATCH", 409);
      const upstream = await tx.identityMapping.findFirst({ where: {
        localBatchId: batchId, senderInstanceId: recipientInstanceId },
        include: { sourceMessage: true } });
      if (!upstream || upstream.sourceMessage.eventType !== "transfer.announced.v1")
        throw new DomainError("UPSTREAM_TRANSFER_NOT_FOUND", 409);
      refs = [{ issuerInstanceId: actual.issuerInstanceId, messageId: actual.messageId,
        eventId: actual.eventId }, { issuerInstanceId: upstream.sourceMessage.issuerInstanceId,
        messageId: upstream.sourceMessage.messageId, eventId: upstream.sourceMessage.eventId }];
      sourceEventRefs = [{ issuerInstanceId: actual.issuerInstanceId, eventId: actual.eventId }];
      downstreamPartnerRef = actual.issuerInstanceId;
      impactType = "downstream_sale";
      impactQuantities = [impact.lots[0]!.quantity];
    } else throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422);
    if (impactQuantities.some((quantity) => quantity === "0"))
      throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422);
    const lots = lines.map((line, index) => ({ sourceLineId: line.id,
      originLot: { issuerInstanceId: batch.originIssuerInstanceId, lotId: batch.originLotId },
      senderBatch: { instanceId: issuerInstanceId, batchId },
      product: { instanceId: issuerInstanceId, productId: batch.productId },
      quantity: impactQuantities[index]!,
      unit: units[line.uom.kind as keyof typeof units] }));
    const now = new Date().toISOString();
    const messageId = randomUUID();
    const payload = { schemaVersion: "1.0", messageId, eventId: randomUUID(),
      eventType: "downstream.impact.v1", issuerInstanceId, recipientInstanceId,
      occurredAt: now, publishedAt: now, correlationId: requestId,
      causationId: sourceDocumentId, sourceDocument: {
        type: document.documentType, id: sourceDocumentId, version: document.version },
      lots, upstreamReferences: refs, evidence: [], sharingPolicyVersion: "v1",
      originLot: { issuerInstanceId: batch.originIssuerInstanceId, lotId: batch.originLotId },
      downstreamPartnerRef, impactType, sourceEventRefs,
      disclosureScope: policy.timelineVisibility };
    try { validateFederationEnvelope(JSON.stringify(payload)); }
    catch { throw new DomainError("DOWNSTREAM_IMPACT_INVALID", 422); }
    await tx.outboxMessage.create({ data: { id: messageId,
      aggregateType: "downstream_impact", aggregateId: messageId,
      aggregateVersion: 1, eventType: "downstream.impact.v1", schemaVersion: "1",
      payload: payload as Prisma.InputJsonObject, destination: "federation",
      correlationId: requestId } });
    await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
      action: "trace.impact.publish", targetType: "document", targetId: sourceDocumentId,
      requestId, after: { messageId, recipientInstanceId,
        disclosureScope: policy.timelineVisibility } });
    return { messageId, state: "pending" as const };
  });
}

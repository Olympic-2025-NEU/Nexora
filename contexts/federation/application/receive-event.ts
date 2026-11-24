// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { classifyFederationReplay, FederationContractError,
  validateFederationEnvelope } from "../../../contracts/events/federation";
import type { PartnerActor } from "../../../platform/identity/partner-actor";
import { assertAcyclic, resolveInbox,
  resolvePendingDependencies } from "./identity-mapping";

export type TechnicalAck = { messageId: string; ackId: string; acceptedAt: string;
  status: "validated" | "pending_dependency" };

/** The ACK and immutable payload commit together. This never changes stock. */
export async function receiveFederationEvent(db: PrismaClient, raw: string,
  actor: PartnerActor, receiverInstanceId: string): Promise<TechnicalAck> {
  if (!receiverInstanceId) throw new Error("NEXORA_ISSUER_INSTANCE_ID is required");
  const checked = validateFederationEnvelope(raw, { receiverInstanceId,
    partnerIssuerInstanceId: actor.issuerInstanceId });
  const { envelope, hash } = checked;
  if (checked.clockSkewWarning) console.warn(JSON.stringify({ service: "federation-inbound",
    code: "CLOCK_SKEW_WARNING", messageId: envelope.messageId }));
  if (envelope.sharingPolicyVersion !== "v1")
    throw new FederationContractError("UNSUPPORTED_SHARING_POLICY", 422);
  const ack = await db.$transaction(async (tx) => {
    const connection = await tx.partnerConnection.findUnique({
      where: { inboundClientId: actor.clientId }, include: { partner: true },
    });
    if (!connection || connection.status !== "active" || connection.partner.status !== "active" ||
        connection.partnerId !== actor.partnerId ||
        connection.partner.issuerInstanceId !== envelope.issuerInstanceId ||
        !connection.allowedInboundScope.split(" ").includes("federation:write"))
      throw new FederationContractError("PARTNER_INACTIVE_OR_UNBOUND", 403);

    // Serialize both idempotency keys, including concurrent same-event/new-message calls.
    const keys = [`m:${envelope.issuerInstanceId}:${envelope.messageId}`,
      `e:${envelope.issuerInstanceId}:${envelope.eventId}:${envelope.eventType}`].sort();
    for (const key of keys)
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const existing = await tx.inboxMessage.findFirst({ where: {
      issuerInstanceId: envelope.issuerInstanceId,
      OR: [{ messageId: envelope.messageId },
        { eventId: envelope.eventId, eventType: envelope.eventType }],
    }, include: { ack: true } });
    if (existing) {
      const replay = classifyFederationReplay({ issuerInstanceId: existing.issuerInstanceId,
        messageId: existing.messageId, eventId: existing.eventId,
        eventType: existing.eventType, hash: existing.payloadSha256,
        ack: existing.ack?.responseBody }, checked);
      if (replay.kind === "replay" && existing.ack) return replay.ack as TechnicalAck;
      throw new Error("INBOX_ACK_MISSING");
    }
    await assertAcyclic(tx, envelope as Parameters<typeof assertAcyclic>[1]);
    const acceptedAt = new Date().toISOString();
    const ack: TechnicalAck = { messageId: envelope.messageId, ackId: randomUUID(),
      acceptedAt, status: "validated" };
    const inboxId = randomUUID();
    await tx.inboxMessage.create({ data: { id: inboxId,
      issuerInstanceId: envelope.issuerInstanceId, messageId: envelope.messageId,
      eventId: envelope.eventId, eventType: envelope.eventType,
      schemaVersion: envelope.schemaVersion, payloadSha256: hash,
      payload: envelope as Prisma.InputJsonObject, partnerId: actor.partnerId,
      state: "validated" } });
    const state = await resolveInbox(tx, inboxId);
    if (state === "pending_dependency") ack.status = "pending_dependency";
    await tx.partnerAck.create({ data: { id: randomUUID(), inboxId,
      ackId: ack.ackId, ackStatus: ack.status,
      responseBody: ack as Prisma.InputJsonObject, sentAt: new Date(acceptedAt) } });
    return ack;
  });
  // A newly arrived parent can satisfy an earlier child. A separate resolver worker
  // may call the same idempotent function after a crash or during backfill.
  try { await resolvePendingDependencies(db); }
  catch { console.error(JSON.stringify({ service: "federation-inbound",
    outcome: "dependency_resolver_retry_pending" })); }
  return ack;
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import { DomainError } from "@/platform/kernel/errors";
import type { AnnouncementSource } from "../application/inbound-announcements";

export function createPrismaAnnouncementSource(tx: Prisma.TransactionClient): AnnouncementSource {
  const verified = (row: { messageId: string; eventType: string; issuerInstanceId: string;
    payload: Prisma.JsonValue; payloadSha256: string }) => ({ messageId: row.messageId,
    eventType: row.eventType, issuerInstanceId: row.issuerInstanceId,
    recipientInstanceId: (row.payload as { recipientInstanceId: string }).recipientInstanceId,
    payload: row.payload, payloadHash: row.payloadSha256 });
  return {
    async find(messageId) {
      const rows = await tx.inboxMessage.findMany({ where: { messageId,
        eventType: "transfer.announced.v1", state: { not: "rejected" } }, take: 2 });
      if (rows.length > 1) throw new DomainError("SOURCE_MESSAGE_AMBIGUOUS", 409);
      return rows.length ? verified(rows[0]) : tx.inboundMessage.findUnique({ where: { messageId } });
    },
    async list() {
      const [inbox, seeded] = await Promise.all([
        tx.inboxMessage.findMany({ where: { eventType: "transfer.announced.v1",
          state: { not: "rejected" } }, orderBy: { receivedAt: "desc" }, take: 100 }),
        tx.inboundMessage.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }),
      ]);
      const liveIds = new Set(inbox.map((row) => row.messageId));
      return [...inbox.map(verified), ...seeded.filter((row) => !liveIds.has(row.messageId))];
    },
    async seed(envelope, payloadHash) {
      await tx.inboundMessage.create({ data: {
        messageId: envelope.messageId as string, eventType: envelope.eventType as string,
        issuerInstanceId: envelope.issuerInstanceId as string,
        recipientInstanceId: envelope.recipientInstanceId as string,
        payload: envelope as Prisma.InputJsonValue, payloadHash,
      } });
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { AnnouncementSource } from "../application/inbound-announcements";

export function createPrismaAnnouncementSource(tx: Prisma.TransactionClient): AnnouncementSource {
  return {
    find(messageId) { return tx.inboundMessage.findUnique({ where: { messageId } }); },
    list() { return tx.inboundMessage.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }); },
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

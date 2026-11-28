// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Decimal } from "@prisma/client/runtime/library";
import envelopeSchema from "@/contracts/events/envelope-v1.schema.json";
import { DomainError } from "@/platform/kernel/errors";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(envelopeSchema);
export type Announcement = {
  schemaVersion: "1.0"; messageId: string; eventId: string; eventType: "transfer.announced.v1";
  issuerInstanceId: string; recipientInstanceId: string; sourceDocument: { type: "partner_transfer"; id: string; version: number };
  lots: { sourceLineId: string; senderBatch: { instanceId: string; batchId: string };
    product: { instanceId: string; productId: string }; originLot: { issuerInstanceId: string; lotId: string };
    quantity: string; unit: "EA" | "KG" | "L" }[];
  sentQuantity: string; linkedIssueId: string;
};
export type StoredAnnouncement = { messageId: string; eventType: string; issuerInstanceId: string;
  recipientInstanceId: string; payload: unknown; payloadHash: string };
export type AnnouncementSource = {
  find(messageId: string): Promise<StoredAnnouncement | null>;
  list(): Promise<StoredAnnouncement[]>;
  seed(envelope: Record<string, unknown>, hash: string): Promise<void>;
};

export function announcementHash(envelope: unknown): string {
  const serialized = canonicalize(envelope);
  if (!serialized) throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
  return createHash("sha256").update(serialized).digest("hex");
}

export function createAnnouncementService(store: AnnouncementSource, instanceId: string) {
  if (!instanceId.trim()) throw new Error("NEXORA_ISSUER_INSTANCE_ID is required");
  function verified(row: StoredAnnouncement): Announcement {
    const payload = row.payload as Announcement;
    if (!validate(payload) || payload.eventType !== "transfer.announced.v1" ||
      payload.sourceDocument.type !== "partner_transfer" || !payload.lots.length ||
      payload.recipientInstanceId !== instanceId || row.messageId !== payload.messageId ||
      row.eventType !== payload.eventType || row.issuerInstanceId !== payload.issuerInstanceId ||
      row.recipientInstanceId !== payload.recipientInstanceId || announcementHash(payload) !== row.payloadHash ||
      new Set(payload.lots.map((lot) => lot.sourceLineId)).size !== payload.lots.length ||
      payload.lots.some((lot) => lot.senderBatch.instanceId !== payload.issuerInstanceId ||
        lot.product.instanceId !== payload.issuerInstanceId) ||
      !payload.lots.reduce((sum, lot) => sum.add(new Decimal(lot.quantity)), new Decimal(0))
        .eq(new Decimal(payload.sentQuantity))) {
      throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
    }
    return payload;
  }
  return {
    async resolveVerifiedAnnouncement(messageId: string) {
      const row = await store.find(messageId);
      if (!row) throw new DomainError("SOURCE_MESSAGE_NOT_FOUND", 422);
      return verified(row);
    },
    async listInboundAnnouncements() {
      const rows = await store.list();
      return rows.flatMap((row) => { try { return [verified(row)]; } catch { return []; } });
    },
    async seedInboundAnnouncement(envelope: Record<string, unknown>) {
      await store.seed(envelope, announcementHash(envelope));
    },
  };
}

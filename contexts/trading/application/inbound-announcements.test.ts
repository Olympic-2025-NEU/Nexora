// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "@/contracts/events/fixtures/a-to-b-transfer-announced.json";
import { announcementHash, createAnnouncementService, type StoredAnnouncement } from "./inbound-announcements";

test("seeded announcement verifies JCS, recipient, type, shape and independent stored payload", async () => {
  const rows = new Map<string, StoredAnnouncement>();
  const service = createAnnouncementService({
    async find(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async seed(envelope, payloadHash) {
      rows.set(envelope.messageId as string, { messageId: envelope.messageId as string,
        eventType: envelope.eventType as string, issuerInstanceId: envelope.issuerInstanceId as string,
        recipientInstanceId: envelope.recipientInstanceId as string, payload: structuredClone(envelope), payloadHash });
    },
  }, "B");
  await service.seedInboundAnnouncement(fixture);
  assert.equal((await service.resolveVerifiedAnnouncement(fixture.messageId)).sentQuantity, "12");
  assert.equal((await service.listInboundAnnouncements()).length, 1);
  const row = rows.get(fixture.messageId)!;
  assert.equal(row.payloadHash, announcementHash(fixture));
  await assert.rejects(service.resolveVerifiedAnnouncement(crypto.randomUUID()), { code: "SOURCE_MESSAGE_NOT_FOUND" });
  for (const altered of [
    { ...fixture, recipientInstanceId: "C" },
    { ...fixture, eventType: "receipt.confirmed.v1" },
    { ...fixture, lots: [] },
    { ...fixture, sentQuantity: "13" },
  ]) {
    row.payload = altered;
    await assert.rejects(service.resolveVerifiedAnnouncement(fixture.messageId), { code: "SOURCE_MESSAGE_INVALID" });
  }
  row.payload = structuredClone(fixture);
  assert.equal((await service.resolveVerifiedAnnouncement(fixture.messageId)).messageId, fixture.messageId);
});

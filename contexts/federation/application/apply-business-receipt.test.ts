// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { applyBusinessReceipt } from "./apply-business-receipt";

const transfer = JSON.parse(readFileSync("contracts/events/fixtures/a-to-b-transfer-announced.json", "utf8"));
const partial = JSON.parse(readFileSync("contracts/events/fixtures/b-to-a-receipt-confirmed.json", "utf8"));
const zero = JSON.parse(readFileSync("contracts/events/fixtures/b-to-a-zero-actual-receipt.json", "utf8"));
const partnerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const inboxId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fixture(existing = false) {
  const writes: { receipt?: unknown; lines?: unknown; state?: unknown } = {};
  const tx = {
    document: { findUnique: async () => ({ id: transfer.sourceDocument.id,
      documentType: "partner_transfer", status: "confirmed",
      transferDetail: { destinationPartnerId: partnerId },
      lines: [{ id: transfer.lots[0].sourceLineId, quantity: new Decimal("12") }] }) },
    outboxMessage: { findFirst: async () => ({ payload: transfer }) },
    businessReceipt: { findUnique: async () => existing ? { id: "existing" } : null,
      create: async ({ data }: { data: unknown }) => { writes.receipt = data; } },
    businessReceiptLine: { createMany: async ({ data }: { data: unknown }) => { writes.lines = data; } },
    transferDetail: { update: async ({ data }: { data: unknown }) => { writes.state = data; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, writes };
}

test("business receipt stores per-line actual and sets partial without changing issue/stock", async () => {
  const { tx, writes } = fixture();
  await applyBusinessReceipt(tx, partial, inboxId, partnerId, "A");
  assert.equal((writes.receipt as { actualQuantity: Decimal }).actualQuantity.toFixed(), "10");
  assert.equal((writes.lines as { actualQuantity: Decimal }[])[0].actualQuantity.toFixed(), "10");
  assert.equal((writes.state as { deliveryState: string }).deliveryState, "partial");
});

test("zero actual keeps one zero line and no positive lot", async () => {
  const { tx, writes } = fixture();
  await applyBusinessReceipt(tx, zero, inboxId, partnerId, "A");
  assert.equal((writes.lines as { actualQuantity: Decimal }[])[0].actualQuantity.toFixed(), "0");
  assert.equal((writes.state as { deliveryState: string }).deliveryState, "partial");
});

test("full actual sets received", async () => {
  const { tx, writes } = fixture();
  const full = structuredClone(partial);
  full.actualLines[0].actualQuantity = "12";
  full.lots[0].quantity = "12";
  full.actualQuantity = "12";
  full.discrepancyQuantity = "0";
  delete full.discrepancyReason;
  await applyBusinessReceipt(tx, full, inboxId, partnerId, "A");
  assert.equal((writes.state as { deliveryState: string }).deliveryState, "received");
});

test("wrong upstream, source line, receiver lot or repeat cannot mutate transfer", async () => {
  const bad = [
    { ...partial, upstreamReferences: [{ ...partial.upstreamReferences[0], messageId: "wrong" }] },
    { ...partial, actualLines: [{ ...partial.actualLines[0], sourceLineId: "wrong" }] },
    { ...partial, lots: [{ ...partial.lots[0], originLot: { ...partial.lots[0].originLot,
      lotId: "wrong" } }] },
  ];
  for (const payload of bad) {
    const { tx, writes } = fixture();
    await assert.rejects(applyBusinessReceipt(tx, payload, inboxId, partnerId, "A"),
      { code: "BUSINESS_RECEIPT_MISMATCH", status: 422 });
    assert.deepEqual(writes, {});
  }
  const { tx, writes } = fixture(true);
  await assert.rejects(applyBusinessReceipt(tx, partial, inboxId, partnerId, "A"),
    { code: "BUSINESS_RECEIPT_ALREADY_EXISTS", status: 409 });
  assert.deepEqual(writes, {});
});

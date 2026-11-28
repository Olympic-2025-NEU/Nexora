// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { FederationContractError, type FederationEnvelope } from "../../../contracts/events/federation";

type Tx = Prisma.TransactionClient;
type Lot = { sourceLineId: string; originLot: { issuerInstanceId: string; lotId: string };
  senderBatch: { instanceId: string; batchId: string }; product: { instanceId: string; productId: string };
  quantity: string; unit: string };
type Ref = { issuerInstanceId: string; messageId: string; eventId: string };
type Receipt = FederationEnvelope & {
  sourceTransfer: { issuerInstanceId: string; id: string };
  sourceDocument: { type: "receiving_confirmation"; id: string; version: number };
  actualLines: { sourceLineId: string; receiverBatchId: string; sentQuantity: string;
    actualQuantity: string; unit: string }[];
  lots: Lot[]; upstreamReferences: Ref[]; sentQuantity: string; actualQuantity: string;
  discrepancyQuantity: string; discrepancyReason?: string;
};
type Transfer = FederationEnvelope & { sourceDocument: { type: "partner_transfer"; id: string };
  lots: Lot[]; sentQuantity: string };

function invalid(code = "BUSINESS_RECEIPT_MISMATCH"): never {
  throw new FederationContractError(code, 422);
}

/** Apply a verified business receipt to the sender's transfer only; never post stock. */
export async function applyBusinessReceipt(tx: Tx, envelope: FederationEnvelope, inboxId: string,
  partnerId: string, localInstanceId: string): Promise<void> {
  const receipt = envelope as Receipt;
  if (receipt.eventType !== "receipt.confirmed.v1" ||
      receipt.sourceTransfer.issuerInstanceId !== localInstanceId) invalid();
  const transfer = await tx.document.findUnique({ where: { id: receipt.sourceTransfer.id },
    include: { transferDetail: true, lines: true } });
  if (!transfer || transfer.documentType !== "partner_transfer" || transfer.status !== "confirmed" ||
      !transfer.transferDetail || transfer.transferDetail.destinationPartnerId !== partnerId)
    invalid("BUSINESS_RECEIPT_SOURCE_NOT_FOUND");
  const originalRow = await tx.outboxMessage.findFirst({ where: { aggregateId: transfer.id,
    eventType: "transfer.announced.v1", destination: "federation" } });
  if (!originalRow) invalid("BUSINESS_RECEIPT_SOURCE_NOT_FOUND");
  const original = originalRow.payload as unknown as Transfer;
  if (original.issuerInstanceId !== localInstanceId ||
      original.recipientInstanceId !== receipt.issuerInstanceId ||
      original.sourceDocument.id !== transfer.id ||
      receipt.upstreamReferences.length !== 1 ||
      receipt.upstreamReferences[0].issuerInstanceId !== localInstanceId ||
      receipt.upstreamReferences[0].messageId !== original.messageId ||
      receipt.upstreamReferences[0].eventId !== original.eventId ||
      !new Decimal(receipt.sentQuantity).eq(original.sentQuantity) ||
      receipt.actualLines.length !== original.lots.length) invalid();
  if (await tx.businessReceipt.findUnique({ where: { transferId: transfer.id } }))
    throw new FederationContractError("BUSINESS_RECEIPT_ALREADY_EXISTS", 409);

  const remaining = [...receipt.lots];
  const lines = original.lots.map((sent) => {
    const actual = receipt.actualLines.find((line) => line.sourceLineId === sent.sourceLineId);
    if (!actual || !new Decimal(actual.sentQuantity).eq(sent.quantity) || actual.unit !== sent.unit ||
        !transfer.lines.some((line) => line.id === sent.sourceLineId &&
          line.quantity?.eq(sent.quantity))) invalid();
    if (new Decimal(actual.actualQuantity).gt(0)) {
      const index = remaining.findIndex((lot) => lot.senderBatch.instanceId === receipt.issuerInstanceId &&
        lot.product.instanceId === receipt.issuerInstanceId &&
        lot.senderBatch.batchId === actual.receiverBatchId &&
        lot.originLot.issuerInstanceId === sent.originLot.issuerInstanceId &&
        lot.originLot.lotId === sent.originLot.lotId &&
        new Decimal(lot.quantity).eq(actual.actualQuantity) && lot.unit === actual.unit);
      if (index < 0) invalid();
      remaining.splice(index, 1);
    }
    return { sourceLineId: sent.sourceLineId, receiverBatchId: actual.receiverBatchId,
      sentQuantity: new Decimal(actual.sentQuantity),
      actualQuantity: new Decimal(actual.actualQuantity), unit: actual.unit };
  });
  if (remaining.length || !lines.reduce((sum, line) => sum.add(line.actualQuantity), new Decimal(0))
    .eq(receipt.actualQuantity)) invalid();
  const id = randomUUID();
  await tx.businessReceipt.create({ data: { id, transferId: transfer.id, inboxId,
    issuerInstanceId: receipt.issuerInstanceId,
    sourceReceivingId: receipt.sourceDocument.id,
    sentQuantity: new Decimal(receipt.sentQuantity),
    actualQuantity: new Decimal(receipt.actualQuantity),
    discrepancyQuantity: new Decimal(receipt.discrepancyQuantity),
    discrepancyReason: receipt.discrepancyReason ?? null } });
  await tx.businessReceiptLine.createMany({ data: lines.map((line) => ({ receiptId: id, ...line })) });
  await tx.transferDetail.update({ where: { documentId: transfer.id }, data: {
    deliveryState: new Decimal(receipt.discrepancyQuantity).isZero() ? "received" : "partial",
    businessReceiptAt: new Date() } });
}

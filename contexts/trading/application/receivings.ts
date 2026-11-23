// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { applyDocumentAction, InvalidTransitionError } from "../domain/document";
import { createTradingRepos } from "../infrastructure/prisma-repos";
import { createAnnouncementService, type Announcement } from "./inbound-announcements";
import { createPrismaAnnouncementSource } from "../infrastructure/inbound-announcements";

type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit(event: OutboxEventInput): void };
type Ports = { audit(tx: Prisma.TransactionClient, input: { actorSub: string; action: string; id: string;
  requestId: string; before?: string; after: string; version: number }): Promise<void>;
  adjust(tx: Prisma.TransactionClient, input: { warehouseId: string; batchId: string; productId: string;
    productVariantId: string; sourceLineId: string; kind: "receiving"; delta: Decimal;
    actorSub: string; correlationId: string }): Promise<{ movement: { id: string } }>;
  event(type: "receipt", input: { id: string; version: number; actorSub: string; correlationId: string;
    lines: { id: string; warehouseId: string; batchId: string; quantity: string;
      originIssuerInstanceId: string; originLotId: string; unit: "EA" | "KG" | "L" }[];
    movementIds: string[] }): OutboxEventInput[] };
export type ActualInput = { sourceLineId: string; localBatchId: string; warehouseId: string;
  actualQuantity: string; unit: "EA" | "KG" | "L" };
export type ReceivingEdit = { actualLines?: { sourceLineId: string; actualQuantity?: string;
  localBatchId?: string; warehouseId?: string; discrepancyReason?: string }[]; discrepancyReason?: string };

function quantity(raw: string, unit: string): Decimal {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,16})(\.[0-9]{1,3})?$/.test(raw) ||
    (unit === "EA" && raw.includes(".") && !new Decimal(raw).isInteger())) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  return new Decimal(raw);
}
function scope(ctx: Context, warehouseId: string) {
  if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  }
}

export function createReceivingService(ports: Ports, instanceId: string) {
  const source = (ctx: Context) => createAnnouncementService(createPrismaAnnouncementSource(ctx.tx), instanceId);
  const repo = (ctx: Context) => createTradingRepos(ctx.tx);
  async function mapping(ctx: Context, lot: Announcement["lots"][number], batchId: string, warehouseId: string, unit: string) {
    scope(ctx, warehouseId);
    const [batch, warehouse] = await Promise.all([repo(ctx).findBatch(batchId), repo(ctx).findWarehouse(warehouseId)]);
    if (!batch) throw new DomainError("BATCH_NOT_FOUND", 422);
    if (batch.productId !== lot.product.productId) throw new DomainError("BATCH_PRODUCT_MISMATCH", 422);
    if (batch.originIssuerInstanceId !== lot.senderBatch.instanceId || batch.originLotId !== lot.senderBatch.batchId) {
      throw new DomainError("ORIGIN_MISMATCH", 422);
    }
    if (!warehouse || warehouse.status !== "active") throw new DomainError("WAREHOUSE_NOT_ACTIVE", 422);
    const variant = await repo(ctx).findVariant(batch.productVariantId);
    const stockUom = variant?.uoms.find((row) => row.isStockKeeping);
    const stockUnit = stockUom && ({ count: "EA", mass: "KG", volume: "L" } as const)
      [stockUom.uom.kind as "count" | "mass" | "volume"];
    if (!stockUom || !stockUnit || stockUnit !== lot.unit || unit !== lot.unit) {
      throw new DomainError("QUANTITY_UNIT_MISMATCH", 422);
    }
    return { batch, uomId: stockUom.uomId };
  }
  function coverage(message: Announcement, inputs: readonly { sourceLineId: string }[]) {
    const sources = new Set(message.lots.map((lot) => lot.sourceLineId));
    const seen = new Set<string>();
    for (const line of inputs) {
      if (!sources.has(line.sourceLineId)) throw new DomainError("SOURCE_LINE_UNKNOWN", 422);
      if (seen.has(line.sourceLineId)) throw new DomainError("SOURCE_LINE_DUPLICATE", 422);
      seen.add(line.sourceLineId);
    }
    if (seen.size !== sources.size) throw new DomainError("SOURCE_LINE_MISSING", 422);
  }
  async function view(ctx: Context, id: string) {
    const doc = await repo(ctx).getAggregate(id);
    if (!doc || doc.documentType !== "receiving_confirmation" || !doc.receivingDetail) {
      throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    }
    if (!doc.lines.length && !ctx.actor.roles.includes("administrator") && doc.createdBySub !== ctx.actor.userId) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    const [internal, reply] = doc.status === "confirmed" ? await Promise.all([
      ctx.tx.outboxMessage.findFirst({ where: { aggregateId: id, eventType: "trading.receipt.confirmed.v1" } }),
      ctx.tx.outboxMessage.findFirst({ where: { aggregateId: id, eventType: "receipt.confirmed.v1" } }),
    ]) : [null, null];
    return { id, documentNumber: doc.documentNumber, status: doc.status, version: doc.version,
      createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
      inboundMessageId: doc.receivingDetail.inboundMessageId,
      sourceIssuerInstanceId: doc.receivingDetail.sourceIssuerInstanceId,
      sourceTransferId: doc.receivingDetail.sourceTransferId,
      sentQuantity: doc.receivingDetail.sentQuantity.toFixed(3),
      actualQuantity: doc.receivingDetail.actualQuantity?.toFixed(3) ?? null,
      discrepancyQuantity: doc.receivingDetail.actualQuantity
        ? doc.receivingDetail.sentQuantity.sub(doc.receivingDetail.actualQuantity).toFixed(3) : null,
      discrepancyReason: doc.receivingDetail.discrepancyReason,
      events: { internal: internal ? { eventType: internal.eventType, status: internal.status } : null,
        reply: reply ? { eventType: reply.eventType, status: reply.status, attempts: reply.attemptCount,
          messageId: (reply.payload as { messageId: string }).messageId } : null },
      lines: doc.lines.map((line) => ({ id: line.id, lineNo: line.lineNo, sourceLineId: line.sourceLineRef,
        batchId: line.batchId, productId: line.productId, productVariantId: line.productVariantId,
        warehouseId: line.warehouseId, uomId: line.uomId, sentQuantity: line.quantity!.toFixed(3),
        actualQuantity: line.actualQuantity!.toFixed(3) })) };
  }
  async function draft(ctx: Context, id: string, version: number, action: "edit" | "cancel") {
    await repo(ctx).lockDocument(id);
    const doc = await repo(ctx).getAggregate(id);
    if (!doc || doc.documentType !== "receiving_confirmation" || !doc.receivingDetail) {
      throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    }
    if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
    try { applyDocumentAction({ type: "receiving_confirmation", status: doc.status as "draft", action }); }
    catch (error) { if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus); throw error; }
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    return doc;
  }
  return {
    source,
    view,
    async options(ctx: Context) {
      const [messages, warehouses] = await Promise.all([
        source(ctx).listInboundAnnouncements(), ctx.tx.warehouse.findMany({ where: { status: "active" },
          select: { id: true, name: true }, take: 100 }),
      ]);
      return { source: "seeded", messages, warehouses: warehouses.filter((row) =>
        ctx.actor.roles.includes("administrator") || ctx.actor.unitIds.includes(row.id)) };
    },
    async batches(ctx: Context, messageId: string) {
      const message = await source(ctx).resolveVerifiedAnnouncement(messageId);
      return Promise.all(message.lots.map(async (lot) => ({ sourceLineId: lot.sourceLineId,
        batches: await ctx.tx.batch.findMany({ where: { productId: lot.product.productId,
          originIssuerInstanceId: message.issuerInstanceId, originLotId: lot.senderBatch.batchId },
        select: { id: true, localCode: true, productVariantId: true } }) })));
    },
    async list(ctx: Context) {
      const page = await repo(ctx).list({ type: "receiving_confirmation", limit: 20,
        ...(ctx.actor.roles.includes("administrator") ? {} : { warehouseIds: ctx.actor.unitIds, creatorSub: ctx.actor.userId }) });
      return { items: await Promise.all(page.items.map((doc) => view(ctx, doc.id))), nextCursorId: page.nextCursorId };
    },
    async create(ctx: Context, input: { inboundMessageId: string; actualLines: ActualInput[]; discrepancyReason?: string }) {
      const message = await source(ctx).resolveVerifiedAnnouncement(input.inboundMessageId);
      coverage(message, input.actualLines);
      await repo(ctx).lockReceivingSource(message.issuerInstanceId, message.sourceDocument.id);
      if (await ctx.tx.receivingDetail.findFirst({ where: { sourceIssuerInstanceId: message.issuerInstanceId,
        sourceTransferId: message.sourceDocument.id, document: { status: { not: "cancelled" } } } })) {
        throw new DomainError("RECEIVING_ALREADY_EXISTS", 409);
      }
      const prepared = await Promise.all(message.lots.map(async (lot) => {
        const inputLine = input.actualLines.find((line) => line.sourceLineId === lot.sourceLineId)!;
        const actual = quantity(inputLine.actualQuantity, lot.unit);
        if (actual.gt(new Decimal(lot.quantity))) throw new DomainError("OVER_RECEIPT", 422);
        return { ...await mapping(ctx, lot, inputLine.localBatchId, inputLine.warehouseId, inputLine.unit),
          actual, inputLine };
      }));
      const id = randomUUID();
      await repo(ctx).createDocument({ id, documentType: "receiving_confirmation", createdBySub: ctx.actor.userId,
        correlationId: ctx.requestId });
      await repo(ctx).attachDetail({ type: "receiving_confirmation", data: { documentId: id,
        inboundMessageId: message.messageId, sourceIssuerInstanceId: message.issuerInstanceId,
        sourceTransferId: message.sourceDocument.id, sentQuantity: message.sentQuantity,
        actualQuantity: prepared.reduce((sum, row) => sum.add(row.actual), new Decimal(0)),
        discrepancyReason: input.discrepancyReason?.trim() || null } });
      await repo(ctx).createLines(id, prepared.map((row, i) => ({ id: randomUUID(), lineNo: i + 1,
        sourceLineRef: message.lots[i]!.sourceLineId, quantity: message.lots[i]!.quantity,
        actualQuantity: row.actual, batchId: row.batch.id, warehouseId: row.inputLine.warehouseId,
        productVariantId: row.batch.productVariantId, productId: row.batch.productId, uomId: row.uomId })));
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.receiving.create", id,
        requestId: ctx.requestId, after: "draft", version: 1 });
      return view(ctx, id);
    },
    async edit(ctx: Context, id: string, version: number, input: ReceivingEdit) {
      const doc = await draft(ctx, id, version, "edit");
      const message = await source(ctx).resolveVerifiedAnnouncement(doc.receivingDetail!.inboundMessageId!);
      if (message.issuerInstanceId !== doc.receivingDetail!.sourceIssuerInstanceId ||
        message.sourceDocument.id !== doc.receivingDetail!.sourceTransferId) throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
      const patches = input.actualLines ?? [];
      const sourceIds = new Set(doc.lines.map((line) => line.sourceLineRef));
      const seen = new Set<string>();
      for (const patch of patches) {
        if (!sourceIds.has(patch.sourceLineId)) throw new DomainError("SOURCE_LINE_UNKNOWN", 422);
        if (seen.has(patch.sourceLineId)) throw new DomainError("SOURCE_LINE_DUPLICATE", 422);
        seen.add(patch.sourceLineId);
      }
      const prepared = await Promise.all(doc.lines.map(async (line) => {
        const patch = patches.find((item) => item.sourceLineId === line.sourceLineRef);
        const lot = message.lots.find((item) => item.sourceLineId === line.sourceLineRef);
        if (!lot || !line.quantity || !line.quantity.eq(lot.quantity)) throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
        const actual = quantity(patch?.actualQuantity ?? line.actualQuantity!.toFixed(), lot.unit);
        if (actual.gt(line.quantity)) throw new DomainError("OVER_RECEIPT", 422);
        const warehouseId = patch?.warehouseId ?? line.warehouseId;
        const valid = await mapping(ctx, lot, patch?.localBatchId ?? line.batchId, warehouseId, lot.unit);
        return { line, actual, warehouseId, ...valid };
      }));
      if (!await repo(ctx).updateDraft(id, version, {})) throw new DomainError("VERSION_CONFLICT", 409);
      for (const item of prepared) {
        await ctx.tx.documentLine.update({ where: { id: item.line.id }, data: { actualQuantity: item.actual,
          batchId: item.batch.id, productVariantId: item.batch.productVariantId,
          productId: item.batch.productId, uomId: item.uomId, warehouseId: item.warehouseId } });
      }
      await ctx.tx.receivingDetail.update({ where: { documentId: id }, data: {
        actualQuantity: prepared.reduce((sum, row) => sum.add(row.actual), new Decimal(0)),
        ...(input.discrepancyReason !== undefined || patches.some((patch) => patch.discrepancyReason !== undefined)
          ? { discrepancyReason: (input.discrepancyReason ?? patches.find((patch) =>
            patch.discrepancyReason !== undefined)?.discrepancyReason)?.trim() || null } : {}),
      } });
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.receiving.edit", id,
        requestId: ctx.requestId, before: "draft", after: "draft", version: version + 1 });
      return view(ctx, id);
    },
    async cancel(ctx: Context, id: string, version: number) {
      const doc = await draft(ctx, id, version, "cancel");
      const updated = await repo(ctx).transition(id, doc.status, version, "cancelled", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.receiving.cancel", id,
        requestId: ctx.requestId, before: "draft", after: "cancelled", version: updated.version });
      return { id, status: "cancelled", version: updated.version };
    },
    async confirm(ctx: Context, id: string, version: number) {
      const doc = await draft(ctx, id, version, "edit");
      const message = await source(ctx).resolveVerifiedAnnouncement(doc.receivingDetail!.inboundMessageId!);
      if (message.issuerInstanceId !== doc.receivingDetail!.sourceIssuerInstanceId ||
        message.sourceDocument.id !== doc.receivingDetail!.sourceTransferId) throw new DomainError("SOURCE_MESSAGE_INVALID", 422);
      coverage(message, doc.lines.map((line) => ({ sourceLineId: line.sourceLineRef! })));
      const prepared = await Promise.all(doc.lines.map(async (line) => {
        const lot = message.lots.find((item) => item.sourceLineId === line.sourceLineRef)!;
        if (!line.quantity || !line.quantity.eq(lot.quantity) || !line.actualQuantity ||
          line.actualQuantity.lt(0) || line.actualQuantity.gt(line.quantity)) throw new DomainError("OVER_RECEIPT", 422);
        const valid = await mapping(ctx, lot, line.batchId, line.warehouseId, lot.unit);
        if (line.productId !== valid.batch.productId || line.productVariantId !== valid.batch.productVariantId ||
          line.uomId !== valid.uomId) throw new DomainError("BATCH_PRODUCT_MISMATCH", 422);
        return { line, lot, batch: valid.batch };
      }));
      const actual = prepared.reduce((sum, { line }) => sum.add(line.actualQuantity!), new Decimal(0));
      if (!doc.receivingDetail!.sentQuantity.eq(message.sentQuantity) ||
        actual.gt(doc.receivingDetail!.sentQuantity)) throw new DomainError("OVER_RECEIPT", 422);
      const reason = doc.receivingDetail!.discrepancyReason?.trim();
      if (!actual.eq(message.sentQuantity) && !reason) throw new DomainError("DISCREPANCY_REASON_REQUIRED", 422);
      await ctx.tx.receivingDetail.update({ where: { documentId: id }, data: { actualQuantity: actual,
        sentQuantity: message.sentQuantity, discrepancyReason: reason || null } });
      const updated = await repo(ctx).transition(id, "draft", version, "confirmed", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      const keys = [...new Map(prepared.filter(({ line }) => line.actualQuantity!.gt(0))
        .map(({ line }) => [`${line.warehouseId}:${line.batchId}`, { warehouseId: line.warehouseId, batchId: line.batchId }])).values()]
        .sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.batchId.localeCompare(b.batchId));
      await repo(ctx).lockBalances(keys);
      const movementIds: string[] = [];
      for (const { line } of prepared) {
        if (line.actualQuantity!.isZero()) continue;
        const result = await ports.adjust(ctx.tx, { warehouseId: line.warehouseId, batchId: line.batchId,
          productId: line.productId, productVariantId: line.productVariantId,
          sourceLineId: line.id, kind: "receiving", delta: line.actualQuantity!,
          actorSub: ctx.actor.userId, correlationId: doc.correlationId });
        movementIds.push(result.movement.id);
      }
      const occurredAt = updated.confirmedAt!.toISOString();
      const eventLines = prepared.filter(({ line }) => line.actualQuantity!.gt(0)).map(({ line, batch, lot }) => ({
        id: line.id, warehouseId: line.warehouseId, batchId: line.batchId,
        quantity: line.actualQuantity!.toFixed(3), originIssuerInstanceId: batch.originIssuerInstanceId,
        originLotId: batch.originLotId, unit: lot.unit,
      }));
      for (const event of ports.event("receipt", { id, version: updated.version, actorSub: ctx.actor.userId,
        correlationId: doc.correlationId, lines: eventLines, movementIds })) ctx.emit(event);
      const envelope = { schemaVersion: "1.0", messageId: randomUUID(), eventId: randomUUID(),
        eventType: "receipt.confirmed.v1", issuerInstanceId: instanceId,
        recipientInstanceId: message.issuerInstanceId, occurredAt, publishedAt: occurredAt,
        correlationId: message.messageId, causationId: message.messageId,
        sourceDocument: { type: "receiving_confirmation", id, version: updated.version },
        lots: prepared.filter(({ line }) => line.actualQuantity!.gt(0)).map(({ line, lot, batch }) => ({
          sourceLineId: line.id, originLot: { issuerInstanceId: batch.originIssuerInstanceId,
            lotId: batch.originLotId }, senderBatch: { instanceId, batchId: line.batchId },
          product: { instanceId, productId: line.productId }, quantity: line.actualQuantity!.toFixed(), unit: lot.unit,
        })),
        upstreamReferences: [{ issuerInstanceId: message.issuerInstanceId,
          messageId: message.messageId, eventId: message.eventId }], evidence: [], sharingPolicyVersion: "v1",
        sourceTransfer: { issuerInstanceId: message.issuerInstanceId, id: message.sourceDocument.id },
        actualLines: prepared.map(({ line, lot }) => ({ sourceLineId: lot.sourceLineId, receiverBatchId: line.batchId,
          sentQuantity: line.quantity!.toFixed(), actualQuantity: line.actualQuantity!.toFixed(), unit: lot.unit })),
        sentQuantity: message.sentQuantity, actualQuantity: actual.toFixed(),
        discrepancyQuantity: new Decimal(message.sentQuantity).sub(actual).toFixed(),
        ...(reason ? { discrepancyReason: reason } : {}),
      };
      ctx.emit({ aggregateType: "document", aggregateId: id, aggregateVersion: updated.version,
        eventType: "receipt.confirmed.v1", schemaVersion: "1", payload: envelope,
        destination: "federation", correlationId: message.messageId,
        nextAttemptAt: new Date("9999-12-31T00:00:00.000Z") });
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.receiving.confirm", id,
        requestId: ctx.requestId, before: "draft", after: "confirmed", version: updated.version });
      return { id, status: "confirmed", version: updated.version, confirmedAt: occurredAt, movementIds };
    },
  };
}

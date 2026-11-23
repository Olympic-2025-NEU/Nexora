// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { applyDocumentAction, assertCorrection, InvalidTransitionError } from "../domain/document";
import { createTradingRepos } from "../infrastructure/prisma-repos";
import { convertToStock } from "./uom-conversion";

export type StocktakeLineInput = { warehouseId: string; productVariantId: string;
  batchId: string; countedQuantity: string; uomId: string };
export type StocktakeInput = { lines: StocktakeLineInput[]; note?: string;
  correctionOfDocumentId?: string; correctionReason?: string };
type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit(event: OutboxEventInput): void };
type Ports = { audit(tx: Prisma.TransactionClient, input: { actorSub: string; action: string; id: string;
  requestId: string; before?: string; after: string; version: number }): Promise<void> };

function scope(ctx: Context, warehouseId: string) {
  if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  }
}
function transition(status: string, action: "edit" | "confirm" | "cancel") {
  try { applyDocumentAction({ type: "stocktake", status: status as "draft", action }); }
  catch (error) { if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus); throw error; }
}
function unique(lines: StocktakeLineInput[]) {
  if (!lines.length) throw new DomainError("NO_LINES", 422);
  if (lines.length > 100) throw new DomainError("TOO_MANY_LINES", 422);
  const keys = new Set<string>();
  for (const line of lines) {
    const key = `${line.warehouseId}:${line.batchId}`;
    if (keys.has(key)) throw new DomainError("DUPLICATE_LINE", 422);
    keys.add(key);
  }
}

export function createStocktakeService(ports: Ports) {
  const repo = (ctx: Context) => createTradingRepos(ctx.tx);
  async function prepare(ctx: Context, lines: StocktakeLineInput[]) {
    unique(lines);
    return Promise.all(lines.map(async (line) => {
      scope(ctx, line.warehouseId);
      const [batch, variant, warehouse] = await Promise.all([
        repo(ctx).findBatch(line.batchId), repo(ctx).findVariant(line.productVariantId), repo(ctx).findWarehouse(line.warehouseId),
      ]);
      if (!batch) throw new DomainError("BATCH_NOT_FOUND", 422);
      if (batch.productVariantId !== line.productVariantId) throw new DomainError("BATCH_VARIANT_MISMATCH", 422);
      if (!variant || variant.productId !== batch.productId || !variant.isActive || variant.deletedAt ||
        !variant.product.isActive || variant.product.deletedAt) throw new DomainError("VARIANT_NOT_FOUND", 422);
      if (!warehouse || warehouse.status !== "active") throw new DomainError("WAREHOUSE_NOT_ACTIVE", 422);
      convertToStock(line.countedQuantity, line.uomId, variant.uoms.map((row) => ({
        uomId: row.uomId, isStockKeeping: row.isStockKeeping, factorToStockUom: row.factorToStockUom.toFixed(),
      })), true);
      return { productId: batch.productId };
    }));
  }
  async function view(ctx: Context, id: string) {
    const doc = await repo(ctx).getAggregate(id);
    if (!doc || doc.documentType !== "stocktake") throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    if (!doc.lines.length && !ctx.actor.roles.includes("administrator") && doc.createdBySub !== ctx.actor.userId) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    return { id, documentNumber: doc.documentNumber, status: doc.status, version: doc.version,
      createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
      note: doc.note, correctionOfDocumentId: doc.correctionOfDocumentId, correctionReason: doc.correctionReason,
      lines: doc.lines.map((line) => ({ id: line.id, lineNo: line.lineNo, warehouseId: line.warehouseId,
        batchId: line.batchId, productVariantId: line.productVariantId, productId: line.productId,
        countedQuantity: line.countedQuantity?.toFixed(3), uomId: line.uomId })) };
  }
  async function draft(ctx: Context, id: string, version: number, action: "edit" | "cancel") {
    await repo(ctx).lockDocument(id);
    const doc = await repo(ctx).getAggregate(id);
    if (!doc || doc.documentType !== "stocktake") throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
    transition(doc.status, action);
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    return doc;
  }
  return {
    view,
    async options(ctx: Context) {
      const warehouses = await ctx.tx.warehouse.findMany({ where: { status: "active" },
        select: { id: true, name: true }, take: 100 });
      const batches = await ctx.tx.batch.findMany({ include: { variant: { include: { uoms: { include: { uom: true } } } } },
        take: 100 });
      const balances = await ctx.tx.stockBalance.findMany({
        where: ctx.actor.roles.includes("administrator") ? {} : { warehouseId: { in: [...ctx.actor.unitIds] } }, take: 100 });
      return { readAt: new Date().toISOString(), warehouses: warehouses.filter((row) =>
        ctx.actor.roles.includes("administrator") || ctx.actor.unitIds.includes(row.id)),
      batches: batches.map((batch) => ({ id: batch.id, productVariantId: batch.productVariantId,
        localCode: batch.localCode, uoms: batch.variant.uoms.map((row) => ({ id: row.uomId,
          name: row.uom.name, isStockKeeping: row.isStockKeeping })),
        balances: balances.filter((row) => row.batchId === batch.id).map((row) => ({
          warehouseId: row.warehouseId, indicativeBalance: row.quantity.toFixed(3) })) })) };
    },
    async list(ctx: Context) {
      const page = await repo(ctx).list({ type: "stocktake", limit: 20,
        ...(ctx.actor.roles.includes("administrator") ? {} : { warehouseIds: ctx.actor.unitIds, creatorSub: ctx.actor.userId }) });
      return { items: await Promise.all(page.items.map((doc) => view(ctx, doc.id))), nextCursorId: page.nextCursorId };
    },
    async create(ctx: Context, input: StocktakeInput) {
      const id = randomUUID();
      const source = input.correctionOfDocumentId ? await repo(ctx).getAggregate(input.correctionOfDocumentId) : null;
      try { assertCorrection({ documentId: id, documentType: "stocktake", correctionOfDocumentId: input.correctionOfDocumentId,
        correctionReason: input.correctionReason, sourceType: source?.documentType as "stocktake" | undefined,
        sourceStatus: source?.status as "confirmed" | undefined,
        existingActiveCorrection: source ? !!await repo(ctx).findActiveCorrection(source.id) : false }); }
      catch (error) { if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus); throw error; }
      const prepared = await prepare(ctx, input.lines);
      await repo(ctx).createDocument({ id, documentType: "stocktake", createdBySub: ctx.actor.userId,
        correlationId: ctx.requestId, note: input.note?.trim() || null,
        correctionOfDocumentId: input.correctionOfDocumentId, correctionReason: input.correctionReason });
      await repo(ctx).createLines(id, input.lines.map((line, i) => ({ id: randomUUID(), lineNo: i + 1,
        warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
        productId: prepared[i]!.productId, uomId: line.uomId, countedQuantity: line.countedQuantity })));
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.stocktake.create", id,
        requestId: ctx.requestId, after: "draft", version: 1 });
      return view(ctx, id);
    },
    async edit(ctx: Context, id: string, version: number, input: { lines?: StocktakeLineInput[]; note?: string }) {
      await draft(ctx, id, version, "edit");
      if (input.lines) {
        const prepared = await prepare(ctx, input.lines);
        const lines = input.lines.map((line, i) => ({ id: randomUUID(), lineNo: i + 1,
          warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
          productId: prepared[i]!.productId, uomId: line.uomId, countedQuantity: line.countedQuantity }));
        if (!await repo(ctx).replaceLines(id, version, lines, input.note?.trim())) throw new DomainError("VERSION_CONFLICT", 409);
      } else if (!await repo(ctx).updateDraft(id, version, { ...(input.note !== undefined ? { note: input.note.trim() } : {}) })) {
        throw new DomainError("VERSION_CONFLICT", 409);
      }
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.stocktake.edit", id,
        requestId: ctx.requestId, before: "draft", after: "draft", version: version + 1 });
      return view(ctx, id);
    },
    async cancel(ctx: Context, id: string, version: number) {
      const doc = await draft(ctx, id, version, "cancel");
      const updated = await repo(ctx).transition(id, "draft", version, "cancelled", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.stocktake.cancel", id,
        requestId: ctx.requestId, before: doc.status, after: "cancelled", version: updated.version });
      return { id, status: "cancelled", version: updated.version };
    },
  };
}

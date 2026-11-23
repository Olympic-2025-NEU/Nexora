// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { InvalidTransitionError, type DocumentStatus } from "../domain/document";
import { createTradingRepos } from "../infrastructure/prisma-repos";
import { aggregateDemand, checkCorrection, checkLines, checkTransition } from "./checklist";
import { convertToStock } from "./uom-conversion";

export type TradingKind = "goods_receipt" | "goods_issue";
export type LineInput = { warehouseId: string; productVariantId: string; batchId: string;
  quantity: string; uomId: string };
export type DocumentInput = { lines: LineInput[]; note?: string; purpose?: "partner_transfer" | "sale" | "other";
  correctionOfDocumentId?: string; correctionReason?: string };
type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit(event: OutboxEventInput): void };
export type TradingPorts = {
  adjust(tx: Prisma.TransactionClient, input: { warehouseId: string; batchId: string; productId: string;
    productVariantId: string; sourceLineId: string; kind: "receipt" | "issue"; delta: Decimal;
    actorSub: string; correlationId: string }): Promise<{ movement: { id: string } }>;
  audit(tx: Prisma.TransactionClient, input: { actorSub: string; action: string; id: string; requestId: string;
    before?: string; after: string; version: number }): Promise<void>;
  event(type: "receipt" | "issue", input: { id: string; version: number; actorSub: string;
    correlationId: string; lines: { id: string; warehouseId: string; batchId: string; quantity: string;
      originIssuerInstanceId: string; originLotId: string; unit: "EA" | "KG" | "L" }[];
    movementIds: string[] }): OutboxEventInput[];
  submit(tx: Prisma.TransactionClient, input: { documentId: string; submittedDocumentVersion: number;
    creatorSub: string; warehouseIds: string[]; lineSnapshotSha256: string }): Promise<{ id: string; state: string }>;
  hash(lines: { lineNo: number; warehouseId: string; productId: string; batchId: string; quantity: number; unit: string }[]): string;
  confirmApproval(tx: Prisma.TransactionClient, input: { approvalRequestId: string; actorSub: string;
    currentLineSnapshotSha256: string }): Promise<void>;
  cancelApproval(tx: Prisma.TransactionClient, input: { approvalRequestId: string; actorSub: string; reason: string;
    approved: boolean }): Promise<void>;
};

function inScope(actor: Actor, warehouseId: string) {
  if (!actor.roles.includes("administrator") && !actor.unitIds.includes(warehouseId)) {
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  }
}

function normalizeTransition(error: unknown): never {
  if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus);
  throw error;
}

export function createDocumentService(ports: TradingPorts) {
  async function validateLine(ctx: Context, line: LineInput, posting = false) {
    const repo = createTradingRepos(ctx.tx);
    inScope(ctx.actor, line.warehouseId);
    const [variant, batch, warehouse] = await Promise.all([
      repo.findVariant(line.productVariantId), repo.findBatch(line.batchId), repo.findWarehouse(line.warehouseId),
    ]);
    if (!variant || variant.deletedAt || !variant.isActive || variant.product.deletedAt || !variant.product.isActive) {
      throw new DomainError("VARIANT_NOT_FOUND", 422);
    }
    if (!batch || batch.productVariantId !== variant.id || batch.productId !== variant.productId) {
      throw new DomainError("BATCH_PRODUCT_MISMATCH", 422);
    }
    if (!warehouse || warehouse.status !== "active") throw new DomainError("WAREHOUSE_NOT_ACTIVE", 422);
    const uoms = variant.uoms.map((item) => ({ uomId: item.uomId,
      isStockKeeping: item.isStockKeeping, factorToStockUom: item.factorToStockUom.toFixed() }));
    const converted = convertToStock(line.quantity, line.uomId, uoms);
    const stockUom = variant.uoms.find((item) => item.isStockKeeping)!;
    if (posting) {
      if (batch.qualityStatus !== "available") throw new DomainError("BATCH_QUALITY_BLOCKED", 422);
      const timezone = (await repo.findOrganization())?.timezone ?? "UTC";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (batch.expiresOn && batch.expiresOn.toISOString().slice(0, 10) < today) {
        throw new DomainError("BATCH_EXPIRED", 422);
      }
    }
    const unit = ({ count: "EA", mass: "KG", volume: "L" } as const)[stockUom.uom.kind as "count" | "mass" | "volume"];
    if (!unit) throw new DomainError("UOM_KIND_INVALID", 422);
    return { ...converted, productId: variant.productId, batch, unit };
  }

  async function view(ctx: Context, id: string, kind: TradingKind) {
    const repo = createTradingRepos(ctx.tx);
    const doc = await repo.getAggregate(id);
    if (!doc || doc.documentType !== kind) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    const lines = await Promise.all(doc.lines.map(async (line) => {
      inScope(ctx.actor, line.warehouseId);
      const converted = doc.status === "draft" && line.quantity
        ? await validateLine(ctx, { warehouseId: line.warehouseId, productVariantId: line.productVariantId,
          batchId: line.batchId, uomId: line.uomId, quantity: line.quantity.toFixed() }) : null;
      return { id: line.id, lineNo: line.lineNo, warehouseId: line.warehouseId,
        productVariantId: line.productVariantId, productId: line.productId, batchId: line.batchId,
        quantity: line.quantity?.toFixed(3) ?? null, uomId: line.uomId,
        ...(converted ? { stockQuantity: converted.stockQuantity, stockUomId: converted.stockUomId } : {}) };
    }));
    const approval = kind === "goods_issue" ? await repo.findApproval(id) : null;
    return { id: doc.id, documentType: doc.documentType, documentNumber: doc.documentNumber,
      status: doc.status, version: doc.version, note: doc.note, purpose: doc.issuePurpose,
      correctionOfDocumentId: doc.correctionOfDocumentId, correctionReason: doc.correctionReason,
      createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
      approval: approval ? { id: approval.id, state: approval.state } : null, lines };
  }

  async function correction(ctx: Context, id: string, kind: TradingKind, input: DocumentInput) {
    const repo = createTradingRepos(ctx.tx);
    const source = input.correctionOfDocumentId ? await repo.getAggregate(input.correctionOfDocumentId) : null;
    try {
      checkCorrection({ documentId: id, documentType: kind, correctionOfDocumentId: input.correctionOfDocumentId,
        correctionReason: input.correctionReason, sourceType: source?.documentType as TradingKind | undefined,
        sourceStatus: source?.status as DocumentStatus | undefined,
        existingActiveCorrection: source ? !!(await repo.findActiveCorrection(source.id)) : false });
    } catch (err) { normalizeTransition(err); }
  }

  return {
    async create(ctx: Context, kind: TradingKind, input: DocumentInput) {
      if (kind === "goods_issue" && !["partner_transfer", "sale", "other"].includes(input.purpose ?? "")) {
        throw new DomainError("ISSUE_PURPOSE_REQUIRED", 422);
      }
      const id = randomUUID();
      await correction(ctx, id, kind, input);
      if (input.lines.length > 100) throw new DomainError("TOO_MANY_LINES", 422);
      const prepared = await Promise.all(input.lines.map((line) => validateLine(ctx, line)));
      const repo = createTradingRepos(ctx.tx);
      await repo.createDocument({ id, documentType: kind, createdBySub: ctx.actor.userId,
        correlationId: ctx.requestId, note: input.note, issuePurpose: kind === "goods_issue" ? input.purpose : null,
        correctionOfDocumentId: input.correctionOfDocumentId, correctionReason: input.correctionReason });
      await repo.createLines(id, input.lines.map((line, i) => ({ id: randomUUID(), lineNo: i + 1,
        warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
        productId: prepared[i]!.productId, uomId: line.uomId, quantity: line.quantity })));
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.document.create",
        id, requestId: ctx.requestId, after: "draft", version: 1 });
      return view(ctx, id, kind);
    },
    view,
    async list(ctx: Context, kind: TradingKind, status?: DocumentStatus, cursorId?: string, limit = 20) {
      const page = await createTradingRepos(ctx.tx).list({ type: kind, status, cursorId, limit,
        ...(ctx.actor.roles.includes("administrator") ? {} : { warehouseIds: ctx.actor.unitIds }) });
      return { items: await Promise.all(page.items.map((doc) => view(ctx, doc.id, kind))), nextCursorId: page.nextCursorId };
    },
    async edit(ctx: Context, kind: TradingKind, id: string, expectedVersion: number,
      input: { lines?: LineInput[]; note?: string }) {
      const repo = createTradingRepos(ctx.tx);
      const doc = await repo.getAggregate(id);
      if (!doc || doc.documentType !== kind) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.version !== expectedVersion) throw new DomainError("VERSION_CONFLICT", 409);
      try { checkTransition(kind, doc.status, "edit"); } catch (err) { normalizeTransition(err); }
      doc.lines.forEach((line) => inScope(ctx.actor, line.warehouseId));
      if (input.lines && input.lines.length > 100) throw new DomainError("TOO_MANY_LINES", 422);
      const prepared = await Promise.all((input.lines ?? []).map((line) => validateLine(ctx, line)));
      if (input.lines) {
        const lines = input.lines.map((line, i) => ({ id: randomUUID(), lineNo: i + 1,
          warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
          productId: prepared[i]!.productId, uomId: line.uomId, quantity: line.quantity }));
        if (!await repo.replaceLines(id, expectedVersion, lines, input.note)) throw new DomainError("VERSION_CONFLICT", 409);
      } else if (!await repo.updateDraft(id, expectedVersion, { note: input.note })) {
        throw new DomainError("VERSION_CONFLICT", 409);
      }
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.document.edit",
        id, requestId: ctx.requestId, before: "draft", after: "draft", version: expectedVersion + 1 });
      return view(ctx, id, kind);
    },
    async action(ctx: Context, kind: TradingKind, id: string, action: "submit" | "confirm" | "cancel", version: number) {
      const repo = createTradingRepos(ctx.tx);
      const doc = await repo.getAggregate(id);
      if (!doc || doc.documentType !== kind) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
      if (action === "submit" && kind !== "goods_issue") throw new DomainError("WRONG_STATE", 409);
      if (action === "confirm" && kind === "goods_issue") {
        if (doc.status !== "pending_approval") throw new DomainError("WRONG_STATE", 409);
      } else {
        try { checkTransition(kind, doc.status, action); } catch (err) { normalizeTransition(err); }
      }
      doc.lines.forEach((line) => inScope(ctx.actor, line.warehouseId));
      const approval = kind === "goods_issue" ? await repo.findApproval(id) : null;
      if (action === "cancel" && approval && approval.state !== "cancelled") {
        await ports.cancelApproval(ctx.tx, { approvalRequestId: approval.id, actorSub: ctx.actor.userId,
          reason: "Document cancelled", approved: approval.state === "approved" });
      }
      let lines = doc.lines;
      if (action !== "cancel") {
        checkLines(lines.map((line) => ({ ...line, quantity: line.quantity?.toFixed() ?? null })));
        const prepared = await Promise.all(lines.map(async (line) => validateLine(ctx, {
          warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
          uomId: line.uomId, quantity: line.quantity!.toFixed(),
        }, true)));
        if (action === "submit" || kind === "goods_receipt") {
          for (const [i, line] of lines.entries()) {
            await repo.normalizeLine(line.id, prepared[i]!.stockQuantity, prepared[i]!.stockUomId);
          }
          lines = (await repo.getAggregate(id))!.lines;
        }
      }
      const next = action === "submit" ? "pending_approval" : action === "confirm" ? "confirmed" : "cancelled";
      const updated = await repo.transition(id, doc.status, version, next, ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      const hash = () => ports.hash(lines.map((line) => {
        if (line.quantity!.mul(1000).gt(Number.MAX_SAFE_INTEGER)) {
          throw new DomainError("APPROVAL_QUANTITY_UNSAFE", 422);
        }
        return { lineNo: line.lineNo,
        warehouseId: line.warehouseId, productId: line.productId, batchId: line.batchId,
        quantity: Number(line.quantity!.toFixed()), unit: line.uomId };
      }));
      if (action === "submit") {
        await ports.submit(ctx.tx, { documentId: id, submittedDocumentVersion: updated.version,
          creatorSub: doc.createdBySub, warehouseIds: [...new Set(lines.map((line) => line.warehouseId))].sort(),
          lineSnapshotSha256: hash() });
      }
      const movementIds: string[] = [];
      if (action === "confirm") {
        if (kind === "goods_issue") {
          if (!approval) throw new DomainError("APPROVAL_NOT_YET_APPROVED", 409);
          if (approval.state === "rejected") throw new DomainError("APPROVAL_REJECTED", 409);
          if (approval.state !== "approved" || approval.haltReason) throw new DomainError("APPROVAL_NOT_YET_APPROVED", 409);
          if (approval.lineSnapshotSha256 !== hash()) throw new DomainError("APPROVAL_LINE_MISMATCH", 409);
          await ports.confirmApproval(ctx.tx, { approvalRequestId: approval.id,
            actorSub: ctx.actor.userId, currentLineSnapshotSha256: hash() });
          const keys = aggregateDemand(lines.map((line) => ({ warehouseId: line.warehouseId,
            batchId: line.batchId, quantity: line.quantity! })));
          const balances = await repo.lockBalances(keys);
          for (const key of keys) {
            const available = balances.find((row) => row.warehouseId === key.warehouseId && row.batchId === key.batchId)?.quantity ?? new Decimal(0);
            if (available.lt(key.requested)) {
              throw new StockShortage(key.batchId, key.requested.toFixed(3), available.toFixed(3));
            }
          }
        }
        for (const line of lines) {
          try {
            const result = await ports.adjust(ctx.tx, { warehouseId: line.warehouseId, batchId: line.batchId,
              productId: line.productId, productVariantId: line.productVariantId,
              sourceLineId: line.id, kind: kind === "goods_receipt" ? "receipt" : "issue",
              delta: kind === "goods_receipt" ? line.quantity! : line.quantity!.neg(),
              actorSub: ctx.actor.userId, correlationId: doc.correlationId });
            movementIds.push(result.movement.id);
          } catch (err) {
            if (err instanceof DomainError && err.code === "INSUFFICIENT_STOCK") {
              throw new DomainError("INSUFFICIENT_STOCK", 422);
            }
            throw err;
          }
        }
        const eventLines = await Promise.all(lines.map(async (line) => {
          const valid = await validateLine(ctx, { warehouseId: line.warehouseId, batchId: line.batchId,
            productVariantId: line.productVariantId, quantity: line.quantity!.toFixed(), uomId: line.uomId }, true);
          return { id: line.id, warehouseId: line.warehouseId, batchId: line.batchId,
            quantity: line.quantity!.toFixed(3), originIssuerInstanceId: valid.batch.originIssuerInstanceId,
            originLotId: valid.batch.originLotId, unit: valid.unit };
        }));
        for (const event of ports.event(kind === "goods_receipt" ? "receipt" : "issue", {
          id, version: updated.version, actorSub: ctx.actor.userId, correlationId: doc.correlationId,
          lines: eventLines, movementIds })) ctx.emit(event);
      }
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: `trading.document.${action}`,
        id, requestId: ctx.requestId, before: doc.status, after: next, version: updated.version });
      return { id, status: next, version: updated.version,
        ...(action === "confirm" ? { confirmedAt: updated.confirmedAt?.toISOString(), movementIds } : {}) };
    },
  };
}

export class StockShortage extends DomainError {
  constructor(readonly batchId: string, readonly requested: string, readonly available: string) {
    super("INSUFFICIENT_STOCK", 422);
  }
}

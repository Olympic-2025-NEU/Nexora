// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { applyDocumentAction, InvalidTransitionError } from "../domain/document";
import { createTradingRepos } from "../infrastructure/prisma-repos";

type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit(event: OutboxEventInput): void };
type Ports = { audit(tx: Prisma.TransactionClient, input: { actorSub: string; action: string; id: string;
  requestId: string; before?: string; after: string; version: number }): Promise<void>;
  event(input: { id: string; linkedIssueId: string; version: number; correlationId: string;
    occurredAt: string; lines: { sourceLineId: string; batchId: string;
      originLot: { issuerInstanceId: string; lotId: string }; quantity: string; unit: "EA" | "KG" | "L" }[] }): OutboxEventInput[] };
function scope(ctx: Context, warehouseId: string) {
  if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
    throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
  }
}
function transition(status: string, action: "confirm" | "cancel") {
  try { applyDocumentAction({ type: "sale_record", status: status as "draft", action }); }
  catch (error) { if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus); throw error; }
}

export function createSaleService(ports: Ports) {
  const repo = (ctx: Context) => createTradingRepos(ctx.tx);
  async function view(ctx: Context, id: string) {
    const doc = await repo(ctx).getAggregate(id);
    if (!doc || doc.documentType !== "sale_record" || !doc.saleDetail) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    if (!doc.lines.length && !ctx.actor.roles.includes("administrator") && doc.createdBySub !== ctx.actor.userId) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    const issue = await ctx.tx.document.findUnique({ where: { id: doc.saleDetail.linkedIssueId },
      select: { documentNumber: true } });
    return { id, documentNumber: doc.documentNumber, status: doc.status, version: doc.version,
      createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
      linkedIssueId: doc.saleDetail.linkedIssueId, linkedIssueNumber: issue?.documentNumber,
      buyerRef: doc.saleDetail.buyerRef, soldAt: doc.saleDetail.soldAt.toISOString(),
      lines: doc.lines.map((line) => ({ id: line.id, sourceIssueLineId: line.sourceIssueLineId,
        lineNo: line.lineNo, warehouseId: line.warehouseId, batchId: line.batchId,
        productVariantId: line.productVariantId, productId: line.productId,
        quantity: line.quantity!.toFixed(3), uomId: line.uomId })) };
  }
  return {
    view,
    async options(ctx: Context) {
      const issues = await ctx.tx.document.findMany({ where: { documentType: "goods_issue", status: "confirmed",
        issuePurpose: "sale", saleIssues: { none: { document: { status: { not: "cancelled" } } } },
        ...(ctx.actor.roles.includes("administrator") ? {} : { lines: { some: {},
          every: { warehouseId: { in: [...ctx.actor.unitIds] } } } }) },
      include: { lines: { orderBy: { lineNo: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
      return { issues: issues.map((issue) => ({ id: issue.id, documentNumber: issue.documentNumber,
        lines: issue.lines.map((line) => ({ batchId: line.batchId, quantity: line.quantity?.toFixed(3),
          warehouseId: line.warehouseId })) })) };
    },
    async list(ctx: Context) {
      const page = await repo(ctx).list({ type: "sale_record", limit: 20,
        ...(ctx.actor.roles.includes("administrator") ? {} : { warehouseIds: ctx.actor.unitIds, creatorSub: ctx.actor.userId }) });
      return { items: await Promise.all(page.items.map((doc) => view(ctx, doc.id))), nextCursorId: page.nextCursorId };
    },
    async create(ctx: Context, input: { linkedIssueId: string; buyerRef?: string; soldAt?: string }) {
      await repo(ctx).lockDocument(input.linkedIssueId);
      const issue = await repo(ctx).getAggregate(input.linkedIssueId);
      if (!issue || issue.documentType !== "goods_issue") throw new DomainError("ISSUE_NOT_FOUND", 422);
      if (issue.issuePurpose !== "sale") throw new DomainError("ISSUE_WRONG_PURPOSE", 422);
      if (issue.status !== "confirmed") throw new DomainError("ISSUE_NOT_CONFIRMED", 409);
      if (await ctx.tx.saleDetail.findFirst({ where: { linkedIssueId: issue.id,
        document: { status: { not: "cancelled" } } } })) throw new DomainError("SALE_ALREADY_EXISTS", 409);
      issue.lines.forEach((line) => scope(ctx, line.warehouseId));
      const now = new Date();
      const soldAt = input.soldAt ? new Date(input.soldAt) : now;
      if (!Number.isFinite(soldAt.getTime()) || soldAt.getTime() > now.getTime()) throw new DomainError("INVALID_SOLD_AT", 422);
      const buyerRef = input.buyerRef?.trim() || null;
      if (buyerRef && buyerRef.length > 64) throw new DomainError("BUYER_REF_TOO_LONG", 422);
      if (!issue.lines.length) throw new DomainError("NO_LINES", 422);
      const id = randomUUID();
      await repo(ctx).createDocument({ id, documentType: "sale_record", createdBySub: ctx.actor.userId,
        correlationId: ctx.requestId });
      await repo(ctx).attachDetail({ type: "sale_record", data: { documentId: id, linkedIssueId: issue.id,
        buyerRef, soldAt } });
      await repo(ctx).createLines(id, issue.lines.map((line) => ({ id: randomUUID(), lineNo: line.lineNo,
        warehouseId: line.warehouseId, batchId: line.batchId, productVariantId: line.productVariantId,
        productId: line.productId, uomId: line.uomId, quantity: line.quantity!, sourceIssueLineId: line.id })));
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.sale.create", id,
        requestId: ctx.requestId, after: "draft", version: 1 });
      return view(ctx, id);
    },
    async cancel(ctx: Context, id: string, version: number) {
      await repo(ctx).lockDocument(id);
      const doc = await repo(ctx).getAggregate(id);
      if (!doc || doc.documentType !== "sale_record" || !doc.saleDetail) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
      transition(doc.status, "cancel");
      doc.lines.forEach((line) => scope(ctx, line.warehouseId));
      const updated = await repo(ctx).transition(id, "draft", version, "cancelled", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.sale.cancel", id,
        requestId: ctx.requestId, before: "draft", after: "cancelled", version: updated.version });
      return { id, status: "cancelled", version: updated.version };
    },
    async confirm(ctx: Context, id: string, version: number) {
      await repo(ctx).lockDocument(id);
      const doc = await repo(ctx).getAggregate(id);
      if (!doc || doc.documentType !== "sale_record" || !doc.saleDetail) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
      transition(doc.status, "confirm");
      await repo(ctx).lockDocument(doc.saleDetail.linkedIssueId);
      const issue = await repo(ctx).getAggregate(doc.saleDetail.linkedIssueId);
      if (!issue || issue.status !== "confirmed") throw new DomainError("ISSUE_NOT_CONFIRMED", 409);
      doc.lines.forEach((line) => scope(ctx, line.warehouseId));
      if (!issue.lines.length || issue.lines.length !== doc.lines.length || doc.lines.some((line) => {
        const source = issue.lines.find((item) => item.id === line.sourceIssueLineId);
        return !source || source.lineNo !== line.lineNo || source.warehouseId !== line.warehouseId ||
          source.batchId !== line.batchId || source.productVariantId !== line.productVariantId ||
          source.productId !== line.productId || source.uomId !== line.uomId ||
          !source.quantity || !line.quantity?.eq(source.quantity);
      })) throw new DomainError("SALE_LINE_MISMATCH", 409);
      const updated = await repo(ctx).transition(id, "draft", version, "confirmed", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      const lines = await Promise.all(doc.lines.map(async (line) => {
        const [batch, uom] = await Promise.all([repo(ctx).findBatch(line.batchId),
          ctx.tx.uom.findUnique({ where: { id: line.uomId } })]);
        const unit = ({ count: "EA", mass: "KG", volume: "L" } as const)[uom?.kind as "count" | "mass" | "volume"];
        if (!batch || !unit) throw new DomainError("SOURCE_LINE_INVALID", 422);
        return { sourceLineId: line.sourceIssueLineId!, batchId: line.batchId,
          originLot: { issuerInstanceId: batch.originIssuerInstanceId, lotId: batch.originLotId },
          quantity: line.quantity!.toFixed(), unit };
      }));
      const occurredAt = updated.confirmedAt!.toISOString();
      for (const event of ports.event({ id, linkedIssueId: issue.id, version: updated.version,
        correlationId: doc.correlationId, occurredAt, lines })) ctx.emit(event);
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.sale.confirm", id,
        requestId: ctx.requestId, before: "draft", after: "confirmed", version: updated.version });
      return { id, status: "confirmed", version: updated.version, confirmedAt: occurredAt, movementIds: [] as string[] };
    },
  };
}

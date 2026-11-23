// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { applyDocumentAction, InvalidTransitionError } from "../domain/document";
import { createTradingRepos } from "../infrastructure/prisma-repos";

type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string; emit(event: OutboxEventInput): void };
type Ports = { audit(tx: Prisma.TransactionClient, input: { actorSub: string; action: string; id: string;
  requestId: string; before?: string; after: string; version: number }): Promise<void> };

export function createTransferService(ports: Ports, instanceId: string) {
  if (!instanceId?.trim()) throw new Error("NEXORA_ISSUER_INSTANCE_ID is required");
  const scope = (ctx: Context, warehouseId: string) => {
    if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
  };
  const partner = async (ctx: Context, id: string, confirming = false) => {
    const row = await ctx.tx.partner.findUnique({ where: { id } });
    if (!row) throw new DomainError("PARTNER_NOT_FOUND", 422);
    if (row.status !== "active") throw new DomainError("PARTNER_INACTIVE", confirming ? 409 : 422);
    if (!row.issuerInstanceId.trim()) throw new DomainError("PARTNER_NOT_FEDERATED", 422);
    if (row.issuerInstanceId === instanceId) throw new DomainError("PARTNER_SELF_TRANSFER", 422);
    return row;
  };
  const view = async (ctx: Context, id: string) => {
    const doc = await createTradingRepos(ctx.tx).getAggregate(id);
    if (!doc || doc.documentType !== "partner_transfer" || !doc.transferDetail) {
      throw new DomainError("DOCUMENT_NOT_FOUND", 404);
    }
    if (!doc.lines.length && !ctx.actor.roles.includes("administrator") && doc.createdBySub !== ctx.actor.userId) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
    doc.lines.forEach((line) => scope(ctx, line.warehouseId));
    const [issue, destination, announcement] = await Promise.all([
      ctx.tx.document.findUnique({ where: { id: doc.transferDetail.linkedIssueId }, select: { documentNumber: true } }),
      ctx.tx.partner.findUnique({ where: { id: doc.transferDetail.destinationPartnerId }, select: { issuerInstanceId: true } }),
      ctx.tx.outboxMessage.findFirst({ where: { aggregateId: id, eventType: "transfer.announced.v1" } }),
    ]);
    return { id, documentNumber: doc.documentNumber, status: doc.status, version: doc.version,
      createdAt: doc.createdAt.toISOString(), confirmedAt: doc.confirmedAt?.toISOString() ?? null,
      note: doc.note, linkedIssueId: doc.transferDetail.linkedIssueId, linkedIssueNumber: issue?.documentNumber,
      destinationPartnerId: doc.transferDetail.destinationPartnerId, recipientInstanceId: destination?.issuerInstanceId,
      deliveryState: doc.transferDetail.deliveryState,
      announcement: announcement ? { messageId: (announcement.payload as { messageId: string }).messageId,
        status: announcement.status, attempts: announcement.attemptCount,
        nextAttemptAt: announcement.nextAttemptAt.toISOString(), lastError: announcement.lastErrorCode } : null,
      lines: doc.lines.map((line) => ({ id: line.id, lineNo: line.lineNo, warehouseId: line.warehouseId,
        batchId: line.batchId, productVariantId: line.productVariantId, productId: line.productId,
        quantity: line.quantity?.toFixed(3), uomId: line.uomId, sourceIssueLineId: line.sourceIssueLineId })) };
  };
  const translate = (error: unknown): never => {
    if (error instanceof InvalidTransitionError) throw new DomainError(error.code, error.httpStatus);
    throw error;
  };
  return {
    view,
    async options(ctx: Context) {
      const issues = await ctx.tx.document.findMany({ where: { documentType: "goods_issue", status: "confirmed",
        issuePurpose: "partner_transfer", transferIssues: { none: { document: { status: { not: "cancelled" } } } },
        ...(ctx.actor.roles.includes("administrator") ? {} : { lines: { some: {}, every: { warehouseId: { in: [...ctx.actor.unitIds] } } } }) },
      select: { id: true, documentNumber: true }, orderBy: { createdAt: "desc" }, take: 100 });
      const partners = await ctx.tx.partner.findMany({ where: { status: "active", issuerInstanceId: { notIn: ["", instanceId] } },
        select: { id: true, displayName: true, issuerInstanceId: true }, take: 100 });
      return { issues, partners };
    },
    async list(ctx: Context) {
      const page = await createTradingRepos(ctx.tx).list({ type: "partner_transfer", limit: 20,
        ...(ctx.actor.roles.includes("administrator") ? {} : { warehouseIds: ctx.actor.unitIds, creatorSub: ctx.actor.userId }) });
      return { items: await Promise.all(page.items.map((doc) => view(ctx, doc.id))), nextCursorId: page.nextCursorId };
    },
    async create(ctx: Context, input: { linkedIssueId: string; destinationPartnerId: string; note?: string }) {
      const repo = createTradingRepos(ctx.tx);
      await repo.lockDocument(input.linkedIssueId);
      const issue = await repo.getAggregate(input.linkedIssueId);
      if (!issue || issue.documentType !== "goods_issue") throw new DomainError("ISSUE_NOT_FOUND", 422);
      if (issue.issuePurpose !== "partner_transfer") throw new DomainError("ISSUE_WRONG_PURPOSE", 422);
      if (issue.status !== "confirmed") throw new DomainError("ISSUE_NOT_CONFIRMED", 409);
      issue.lines.forEach((line) => scope(ctx, line.warehouseId));
      if (await ctx.tx.transferDetail.findFirst({ where: { linkedIssueId: issue.id,
        document: { status: { not: "cancelled" } } } })) throw new DomainError("TRANSFER_ALREADY_EXISTS", 409);
      await partner(ctx, input.destinationPartnerId);
      const id = randomUUID();
      await repo.createDocument({ id, documentType: "partner_transfer", createdBySub: ctx.actor.userId,
        correlationId: ctx.requestId, note: input.note });
      await repo.attachDetail({ type: "partner_transfer", data: { documentId: id,
        linkedIssueId: issue.id, destinationPartnerId: input.destinationPartnerId } });
      await repo.createLines(id, issue.lines.map((line) => ({ id: randomUUID(), lineNo: line.lineNo,
        warehouseId: line.warehouseId, productVariantId: line.productVariantId, productId: line.productId,
        batchId: line.batchId, quantity: line.quantity!, uomId: line.uomId, sourceIssueLineId: line.id })));
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.transfer.create", id,
        requestId: ctx.requestId, after: "draft", version: 1 });
      return view(ctx, id);
    },
    async cancel(ctx: Context, id: string, version: number) {
      const repo = createTradingRepos(ctx.tx);
      await repo.lockDocument(id);
      const doc = await repo.getAggregate(id);
      if (!doc || doc.documentType !== "partner_transfer" || !doc.transferDetail) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
      try { applyDocumentAction({ type: "partner_transfer", status: doc.status as "draft", action: "cancel" }); }
      catch (error) { translate(error); }
      doc.lines.forEach((line) => scope(ctx, line.warehouseId));
      const updated = await repo.transition(id, doc.status, version, "cancelled", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.transfer.cancel", id,
        requestId: ctx.requestId, before: doc.status, after: "cancelled", version: updated.version });
      return { id, status: "cancelled", version: updated.version };
    },
    async confirm(ctx: Context, id: string, version: number) {
      const repo = createTradingRepos(ctx.tx);
      await repo.lockDocument(id);
      const doc = await repo.getAggregate(id);
      if (!doc || doc.documentType !== "partner_transfer" || !doc.transferDetail) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      await repo.lockDocument(doc.transferDetail.linkedIssueId);
      if (doc.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
      try { applyDocumentAction({ type: "partner_transfer", status: doc.status as "draft", action: "confirm" }); }
      catch (error) { translate(error); }
      const issue = await repo.getAggregate(doc.transferDetail.linkedIssueId);
      if (!issue || issue.status !== "confirmed") throw new DomainError("ISSUE_NOT_CONFIRMED", 409);
      const destination = await partner(ctx, doc.transferDetail.destinationPartnerId, true);
      if (issue.lines.length !== doc.lines.length || issue.lines.length === 0 ||
          doc.lines.some((line) => { const source = issue.lines.find((item) => item.id === line.sourceIssueLineId);
            return !source || source.lineNo !== line.lineNo || source.warehouseId !== line.warehouseId ||
              source.batchId !== line.batchId || source.productVariantId !== line.productVariantId ||
              source.productId !== line.productId || source.uomId !== line.uomId ||
              !line.quantity || !source.quantity || !line.quantity.eq(source.quantity); })) {
        throw new DomainError("TRANSFER_LINE_MISMATCH", 409);
      }
      doc.lines.forEach((line) => scope(ctx, line.warehouseId));
      const updated = await repo.transition(id, doc.status, version, "confirmed", ctx.actor.userId);
      if (!updated) throw new DomainError("VERSION_CONFLICT", 409);
      const uoms = await ctx.tx.uom.findMany({ where: { id: { in: doc.lines.map((line) => line.uomId) } } });
      const lots = doc.lines.map((line) => {
        const unit = ({ count: "EA", mass: "KG", volume: "L" } as const)[uoms.find((row) => row.id === line.uomId)?.kind as "count" | "mass" | "volume"];
        if (!unit) throw new DomainError("UOM_KIND_INVALID", 422);
        return { sourceLineId: line.id,
          originLot: { issuerInstanceId: instanceId, lotId: line.batchId },
          senderBatch: { instanceId, batchId: line.batchId },
          product: { instanceId, productId: line.productId }, quantity: line.quantity!.toFixed(), unit };
      });
      const occurredAt = updated.confirmedAt!.toISOString();
      const payload = { schemaVersion: "1.0", messageId: randomUUID(), eventId: randomUUID(),
        eventType: "transfer.announced.v1", issuerInstanceId: instanceId,
        recipientInstanceId: destination.issuerInstanceId, occurredAt, publishedAt: occurredAt,
        correlationId: doc.correlationId, causationId: issue.id,
        sourceDocument: { type: "partner_transfer", id, version: updated.version }, lots,
        upstreamReferences: [], evidence: [], sharingPolicyVersion: "v1",
        linkedIssueId: issue.id, sentQuantity: doc.lines.reduce((sum, line) => sum.add(line.quantity!), new Decimal(0)).toFixed() };
      ctx.emit({ aggregateType: "document", aggregateId: id, aggregateVersion: updated.version,
        eventType: "transfer.announced.v1", schemaVersion: "1", payload,
        destination: "federation", correlationId: doc.correlationId,
        nextAttemptAt: new Date("9999-12-31T00:00:00.000Z") });
      await ports.audit(ctx.tx, { actorSub: ctx.actor.userId, action: "trading.transfer.confirm", id,
        requestId: ctx.requestId, before: doc.status, after: "confirmed", version: updated.version });
      return { id, status: "confirmed", version: updated.version, confirmedAt: occurredAt, movementIds: [] };
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "../../platform/persistence/prisma";
import { createPrismaIdempotency } from "../../platform/http/idempotency";
import { runCommand } from "../../platform/http/pipeline";
import { tradingService, tradingUnitOfWork, tradingPorts, transferService } from "../../composition/trading";
import { applyApprovalResult } from "../../composition/workflow";
import { createReceivingService } from "../../contexts/trading/application/receivings";
import { createDocumentService, type TradingKind } from "../../contexts/trading/application/documents";
import { createTransferService } from "../../contexts/trading/application/transfers";
import { createStocktakeService } from "../../contexts/trading/application/stocktakes";
import { createSaleService } from "../../contexts/trading/application/sales";
import { adjustStock } from "../../contexts/inventory/application/adjust-stock";
import { createCatalogRepos } from "../../contexts/catalog/infrastructure/prisma-repos";
import { serializeDomainEvent, TRADING_EVENT_TYPES, EVENT_DESTINATIONS } from "../../contracts/events/registry";
import type { Actor } from "../../platform/identity/actor";
import type { OutboxMessage } from "../../platform/outbox/message";
import { FlowableClient } from "../../platform/workflow/flowable-client";
import { createFlowableStarter } from "../../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../../platform/workflow/flowable-decider";
import { reconcileApproval } from "../../platform/workflow/reconciler";
import { recordDecisionIntent } from "../../platform/workflow/approval-service";

if (process.env.NEXORA_TEST_DB !== "1") throw new Error("Disposable PostgreSQL required");
const owner = new PrismaClient({ datasources: { db: { url: process.env.OWNER_DATABASE_URL! } } });
const db = getPrismaClient();
const warehouseId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), batchId = randomUUID();
const stockUomId = "aaaaaaaa-0001-4000-8000-000000000001";
const actor: Actor = { userId: "conformance-creator", organizationId: "fixture-org", roles: ["staff"], unitIds: [warehouseId] };
process.env.NEXORA_ISSUER_INSTANCE_ID = "local-instance";
let partnerId = "";
const line = (quantity: string, batch = batchId) => ({ warehouseId, productVariantId: variantId, batchId: batch, quantity, uomId: stockUomId });
const FAULT = new Error("injected conformance fault");

before(async () => {
  const org = (await owner.organization.findFirst()) ??
    (await owner.organization.create({ data: { id: randomUUID(), instanceId: randomUUID(), code: "CONF", name: "Conformance fixture" } }));
  await owner.$executeRaw`INSERT INTO inventory.warehouse(id,code,name,status,created_by_sub)
    VALUES (${warehouseId}::uuid,${randomUUID()},'Conformance warehouse','active','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id,name,category_id,created_by_sub)
    VALUES (${productId}::uuid,'Conformance product','bbbbbbbb-0001-4000-8000-000000000001','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id,product_id,sku,created_by_sub)
    VALUES (${variantId}::uuid,${productId}::uuid,${randomUUID()},'fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant_uom(id,product_variant_id,uom_id,is_stock_keeping,factor_to_stock_uom)
    VALUES (${randomUUID()}::uuid,${variantId}::uuid,${stockUomId}::uuid,true,1)`;
  await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
    VALUES (${batchId}::uuid,${productId}::uuid,${variantId}::uuid,${randomUUID()},'issuer',${randomUUID()}::uuid,'available','fixture')`;
  for (const [sub, role] of [[actor.userId, "staff"], ["fixture-approver", "approver"]]) {
    const member = (await owner.membership.findUnique({ where: { keycloakSub: sub } })) ??
      (await owner.membership.create({ data: {
        id: randomUUID(), organizationId: org.id, keycloakSub: sub, displayName: sub, role, status: "active",
      } }));
    await owner.membershipWarehouse.create({ data: { membershipId: member.id, warehouseId } })
      .catch(() => {});
  }
  const partner = (await owner.partner.findFirst({ where: { issuerInstanceId: "remote-instance" } })) ??
    (await owner.partner.create({ data: { id: randomUUID(), issuerInstanceId: "remote-instance", code: randomUUID(),
      displayName: "Remote", createdBySub: "fixture" } }));
  partnerId = partner.id;
});
after(async () => { await db.$disconnect(); await owner.$disconnect(); });

async function command<T>(action: string, body: unknown,
  work: (ctx: Parameters<typeof tradingService.create>[0]) => Promise<T>, key?: string,
  kind: TradingKind = "goods_receipt", actingActor: Actor = actor): Promise<T> {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actingActor, resolveTenant: async () => actingActor.organizationId,
    action: `trading:${kind === "goods_receipt" ? "receipt" : "issue"}:${action}`,
    unitOfWork: tradingUnitOfWork,
    method: "POST", routeKey: `receipt:${action}`, payload: body,
    idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db),
    domain: (ctx) => work({ tx: ctx.tx, actor: actingActor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

function transferCommand<T>(action: "create" | "cancel" | "confirm", payload: unknown,
  work: (ctx: Parameters<ReturnType<typeof transferService>["create"]>[0]) => Promise<T>, key?: string) {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actor, resolveTenant: async () => actor.organizationId,
    action: `trading:transfer:${action}`, method: "POST", routeKey: `transfer:${action}`,
    payload, idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db), unitOfWork: tradingUnitOfWork,
    domain: (ctx) => work({ tx: ctx.tx, actor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

function receivingCommand<T>(action: "create" | "confirm", payload: unknown,
  work: (ctx: Parameters<ReturnType<typeof createReceivingService>["create"]>[0]) => Promise<T>, key?: string) {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actor, resolveTenant: async () => actor.organizationId,
    action: `trading:receiving:${action}`, method: "POST", routeKey: `receiving:${action}`,
    payload, idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db), unitOfWork: tradingUnitOfWork,
    domain: (ctx) => work({ tx: ctx.tx, actor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

function stockCommand<T>(action: string, body: unknown,
  work: (ctx: Parameters<ReturnType<typeof createStocktakeService>["create"]>[0]) => Promise<T>,
  key?: string, actingActor: Actor = actor): Promise<T> {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actingActor, resolveTenant: async () => actingActor.organizationId,
    action: `trading:stocktake:${action}`, unitOfWork: tradingUnitOfWork,
    method: "POST", routeKey: `stocktake:${action}`, payload: body,
    idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db),
    domain: (ctx) => work({ tx: ctx.tx, actor: actingActor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

function saleCommand<T>(action: "create" | "confirm", body: unknown,
  work: (ctx: Parameters<ReturnType<typeof createSaleService>["create"]>[0]) => Promise<T>, key?: string): Promise<T> {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actor, resolveTenant: async () => actor.organizationId,
    action: `trading:sale:${action}`, unitOfWork: tradingUnitOfWork,
    method: "POST", routeKey: `sale:${action}`, payload: body,
    idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db),
    domain: (ctx) => work({ tx: ctx.tx, actor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

async function approve(id: string) {
  const engine = FlowableClient.fromEnv();
  const requested = await db.outboxMessage.findFirstOrThrow({ where: {
    aggregateType: "approval_request", eventType: "workflow.approval.requested.v1",
    payload: { path: ["documentId"], equals: id },
  } });
  await createFlowableStarter(db, engine)(requested as OutboxMessage);
  const row = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: id } });
  const task = (await engine.queryTasks({ processInstanceId: row.flowableProcessId! }))[0]!;
  const resolver = async (sub: string) => ({ sub, active: true,
    role: sub === "fixture-approver" ? "approver" : "staff", warehouseIds: [warehouseId] });
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: "fixture-approver", decision: "approved",
    flowableTaskId: task.id, expectedVersion: row.version,
  }));
  const message = await db.outboxMessage.findFirstOrThrow({ where: {
    aggregateId: row.id, eventType: "workflow.approval.decision_requested.v1",
    aggregateVersion: intent.version,
  } });
  await createFlowableDecider(db, engine, resolver)(message as OutboxMessage);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await reconcileApproval(db, engine, row.id, applyApprovalResult);
    const state = (await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state;
    if (state === "approved") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Decision was not reconciled before timeout");
}

async function balance() {
  const row = await db.stockBalance.findUnique({ where: { warehouseId_batchId: { warehouseId, batchId } } });
  return row ? row.quantity.toFixed(3) : "0.000";
}

async function balanceOf(batch: string) {
  const row = await db.stockBalance.findUnique({ where: { warehouseId_batchId: { warehouseId, batchId: batch } } });
  return row ? row.quantity.toFixed(3) : "0.000";
}

async function expectRolledBack(doc: { id: string; lines: { id: string }[] }, auditAction: string,
  status: string, balanceBefore: string, bal: () => Promise<string> = balance) {
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, status);
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: doc.lines.map((l) => l.id) } } }), 0);
  assert.equal(await db.auditLog.count({ where: { targetId: doc.id, action: auditAction } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: doc.id } }), 0);
  assert.equal(await bal(), balanceBefore);
}

const faultDocs = (point: "adjust" | "audit" | "event" | "approval") => createDocumentService({
  ...tradingPorts,
  ...(point === "adjust" ? { adjust: async () => { throw FAULT; } } : {}),
  ...(point === "audit" ? { audit: async () => { throw FAULT; } } : {}),
  ...(point === "event" ? { event: () => { throw FAULT; } } : {}),
  ...(point === "approval" ? { confirmApproval: async () => { throw FAULT; } } : {}),
});
const faultTransfer = (point: "audit" | "event") => createTransferService({
  ...tradingPorts,
  ...(point === "audit" ? { audit: async () => { throw FAULT; } } : {}),
  ...(point === "event" ? { transferEvent: () => { throw FAULT; } } : {}),
}, "local-instance");
const faultReceiving = (point: "adjust" | "audit" | "event") => createReceivingService({
  ...tradingPorts,
  ...(point === "adjust" ? { adjust: async () => { throw FAULT; } } : {}),
  ...(point === "audit" ? { audit: async () => { throw FAULT; } } : {}),
  ...(point === "event" ? { receivingEvent: () => { throw FAULT; } } : {}),
}, "remote-instance");
type StocktakeEventInput = Parameters<Parameters<typeof createStocktakeService>[0]["event"]>[0];
type SaleEventInput = Parameters<Parameters<typeof createSaleService>[0]["event"]>[0];
const stocktakePorts = (point?: "adjust" | "audit" | "event") => ({
  audit: point === "audit" ? (async () => { throw FAULT; }) : tradingPorts.audit,
  adjust: point === "adjust" ? (async () => { throw FAULT; }) : adjustStock,
  event: point === "event" ? (() => { throw FAULT; }) : (input: StocktakeEventInput) =>
    serializeDomainEvent({ type: TRADING_EVENT_TYPES.stocktake, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      payload: { eventId: randomUUID(), documentId: input.id, documentVersion: input.version,
        lines: input.lines, actorSub: input.actorSub, reason: input.reason, occurredAt: input.occurredAt } }),
});
const salePorts = (point?: "audit" | "event") => ({
  audit: point === "audit" ? (async () => { throw FAULT; }) : tradingPorts.audit,
  event: point === "event" ? (() => { throw FAULT; }) : (input: SaleEventInput) =>
    serializeDomainEvent({ type: TRADING_EVENT_TYPES.sale, aggregateType: "document",
      aggregateId: input.id, aggregateVersion: input.version, correlationId: input.correlationId,
      destinations: [EVENT_DESTINATIONS.traceability],
      payload: { eventId: randomUUID(), saleId: input.id, linkedIssueId: input.linkedIssueId,
        lines: input.lines, occurredAt: input.occurredAt } }),
});

async function confirmedReceipt(quantity: string) {
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line(quantity)] }));
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  return receipt;
}

async function approvedIssue(quantity: string, purpose: "partner_transfer" | "sale") {
  const issue = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose, lines: [line(quantity)] }), undefined, "goods_issue");
  await command("submit", { id: issue.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "submit", issue.version), undefined, "goods_issue");
  await approve(issue.id);
  const current = await db.document.findUniqueOrThrow({ where: { id: issue.id } });
  return { ...issue, version: current.version };
}

test("conformance: receipt confirm rolls back at adjust, audit and event", { timeout: 120_000 }, async () => {
  for (const point of ["adjust", "audit", "event"] as const) {
    const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
      { lines: [line("5")] }));
    const before = await balance();
    await assert.rejects(command("confirm", { id: receipt.id }, (ctx) => faultDocs(point).action(ctx,
      "goods_receipt", receipt.id, "confirm", receipt.version)), /injected conformance fault/);
    await expectRolledBack(receipt, "trading.document.confirm", "draft", before);
  }
});

test("conformance: issue confirm rolls back at approval, adjust, audit and event", { timeout: 180_000 }, async () => {
  for (const point of ["approval", "adjust", "audit", "event"] as const) {
    await confirmedReceipt("5");
    const issue = await approvedIssue("5", "partner_transfer");
    const before = await balance();
    await assert.rejects(command("confirm", { id: issue.id }, (ctx) => faultDocs(point).action(ctx,
      "goods_issue", issue.id, "confirm", issue.version), randomUUID(), "goods_issue"),
    /injected conformance fault/);
    await expectRolledBack(issue, "trading.document.confirm", "approved", before);
  }
});

test("conformance: transfer confirm rolls back at audit and emit", { timeout: 180_000 }, async () => {
  for (const point of ["audit", "emit"] as const) {
    await confirmedReceipt("5");
    const issue = await approvedIssue("5", "partner_transfer");
    await command("confirm", { id: issue.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", issue.id, "confirm", issue.version), randomUUID(), "goods_issue");
    const transfer = await transferCommand("create", {}, (ctx) => transferService().create(ctx,
      { linkedIssueId: issue.id, destinationPartnerId: partnerId }));
    const before = await balance();
    await assert.rejects(transferCommand("confirm", { id: transfer.id }, (ctx) =>
      point === "audit"
        ? faultTransfer("audit").confirm(ctx, transfer.id, transfer.version)
        : transferService().confirm({ ...ctx, emit: () => { throw FAULT; } }, transfer.id, transfer.version)),
    /injected conformance fault/);
    await expectRolledBack(transfer, "trading.transfer.confirm", "draft", before);
  }
});

async function receivingDraft() {
  const sourceBatch = randomUUID();
  await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
    VALUES (${sourceBatch}::uuid,${productId}::uuid,${variantId}::uuid,${randomUUID()},'issuer',${randomUUID()}::uuid,'available','fixture')`;
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line("5", sourceBatch)] }));
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  const issue = await (async () => {
    const created = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
      { purpose: "partner_transfer", lines: [line("5", sourceBatch)] }), undefined, "goods_issue");
    await command("submit", { id: created.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", created.id, "submit", created.version), undefined, "goods_issue");
    await approve(created.id);
    const current = await db.document.findUniqueOrThrow({ where: { id: created.id } });
    return { ...created, version: current.version };
  })();
  await command("confirm", { id: issue.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "confirm", issue.version), randomUUID(), "goods_issue");
  const transfer = await transferCommand("create", {}, (ctx) => transferService().create(ctx,
    { linkedIssueId: issue.id, destinationPartnerId: partnerId }));
  await transferCommand("confirm", { id: transfer.id }, (ctx) => transferService().confirm(ctx,
    transfer.id, transfer.version), randomUUID());
  const announced = await db.outboxMessage.findFirstOrThrow({ where: {
    aggregateId: transfer.id, eventType: "transfer.announced.v1" } });
  const envelope = announced.payload as Record<string, unknown>;
  const sourceLot = (envelope.lots as { sourceLineId: string; senderBatch: { batchId: string } }[])[0]!;
  const real = createReceivingService(tradingPorts, "remote-instance");
  await db.$transaction((tx) => real.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .seedInboundAnnouncement(envelope));
  const localBatch = await createCatalogRepos(db).createBatch({ id: randomUUID(), productVariantId: variantId,
    localCode: randomUUID(), originIssuerInstanceId: "local-instance", originLotId: sourceLot.senderBatch.batchId,
    createdBySub: actor.userId });
  const input = { inboundMessageId: envelope.messageId as string,
    actualLines: [{ sourceLineId: sourceLot.sourceLineId, localBatchId: localBatch.id, warehouseId,
      actualQuantity: "5", unit: "EA" as const }] };
  const draft = await receivingCommand("create", input, (ctx) => real.create(ctx, input));
  return { draft, localBatchId: localBatch.id };
}

test("conformance: receiving confirm rolls back at adjust, audit and event", { timeout: 240_000 }, async () => {
  for (const point of ["adjust", "audit", "event"] as const) {
    const { draft, localBatchId } = await receivingDraft();
    const before = await balanceOf(localBatchId);
    await assert.rejects(receivingCommand("confirm", { id: draft.id }, (ctx) =>
      faultReceiving(point).confirm(ctx, draft.id, draft.version)), /injected conformance fault/);
    await expectRolledBack(draft, "trading.receiving.confirm", "draft", before, () => balanceOf(localBatchId));
  }
});

test("conformance: stocktake confirm rolls back at adjust, audit and event", { timeout: 120_000 }, async () => {
  for (const point of ["adjust", "audit", "event"] as const) {
    await confirmedReceipt("10");
    const draft = await stockCommand("create", {}, (ctx) => createStocktakeService(stocktakePorts()).create(ctx, {
      lines: [{ warehouseId, productVariantId: variantId, batchId, countedQuantity: "7", uomId: stockUomId }],
      note: "conformance count",
    }));
    const before = await balance();
    await assert.rejects(stockCommand("confirm", { id: draft.id }, (ctx) =>
      createStocktakeService(stocktakePorts(point)).confirm(ctx, draft.id, draft.version)),
    /injected conformance fault/);
    await expectRolledBack(draft, "trading.stocktake.confirm", "draft", before);
  }
});

test("conformance: sale confirm rolls back at audit and event", { timeout: 180_000 }, async () => {
  for (const point of ["audit", "event"] as const) {
    await confirmedReceipt("6");
    const issue = await approvedIssue("2", "sale");
    await command("confirm", { id: issue.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", issue.id, "confirm", issue.version), randomUUID(), "goods_issue");
    const sale = await saleCommand("create", {}, (ctx) => createSaleService(salePorts()).create(ctx,
      { linkedIssueId: issue.id }));
    const before = await balance();
    await assert.rejects(saleCommand("confirm", { id: sale.id }, (ctx) =>
      createSaleService(salePorts(point)).confirm(ctx, sale.id, sale.version)), /injected conformance fault/);
    await expectRolledBack(sale, "trading.sale.confirm", "draft", before);
  }
});

test("permission change: revoked warehouse scope cannot confirm receipt, issue or stocktake", { timeout: 180_000 }, async () => {
  const revoked: Actor = { ...actor, unitIds: [] };
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line("5")] }));
  await assert.rejects(command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), undefined, "goods_receipt", revoked),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  const issue = await approvedIssue("5", "partner_transfer");
  await assert.rejects(command("confirm", { id: issue.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "confirm", issue.version), undefined, "goods_issue", revoked),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: issue.id } })).status, "approved");
  const stocktake = await stockCommand("create", {}, (ctx) => createStocktakeService(stocktakePorts()).create(ctx, {
    lines: [{ warehouseId, productVariantId: variantId, batchId, countedQuantity: "9", uomId: stockUomId }],
    note: "revocation check",
  }));
  await assert.rejects(stockCommand("confirm", { id: stocktake.id }, (ctx) =>
    createStocktakeService(stocktakePorts()).confirm(ctx, stocktake.id, stocktake.version), undefined, revoked),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
});

test("invariant scan: balances equal movement sums and confirmed documents carry matrix effects", { timeout: 240_000 }, async () => {
  const sums = await db.stockMovement.groupBy({ by: ["warehouseId", "batchId"], _sum: { delta: true } });
  const sumByKey = new Map(sums.map((row) => [`${row.warehouseId}|${row.batchId}`, row._sum.delta!.toFixed(3)]));
  for (const row of await db.stockBalance.findMany()) {
    assert.equal(row.quantity.toFixed(3), sumByKey.get(`${row.warehouseId}|${row.batchId}`) ?? "0.000",
      `balance drift at ${row.warehouseId}|${row.batchId}`);
  }
  const confirmAction: Record<string, string> = {
    goods_receipt: "trading.document.confirm", goods_issue: "trading.document.confirm",
    partner_transfer: "trading.transfer.confirm", receiving_confirmation: "trading.receiving.confirm",
    stocktake: "trading.stocktake.confirm", sale_record: "trading.sale.confirm",
  };
  const docs = await db.document.findMany({ include: { lines: true } });
  for (const doc of docs) {
    const movements = await db.stockMovement.count({
      where: { sourceLineId: { in: doc.lines.map((l) => l.id) } } });
    if (doc.status !== "confirmed") {
      assert.equal(movements, 0, `non-confirmed ${doc.documentType} ${doc.id} has movements`);
      continue;
    }
    if (doc.documentType === "goods_receipt" || doc.documentType === "goods_issue") {
      assert.equal(movements, doc.lines.length, `${doc.documentType} ${doc.id} movement count`);
    } else if (doc.documentType === "partner_transfer" || doc.documentType === "sale_record") {
      assert.equal(movements, 0, `${doc.documentType} ${doc.id} must not move stock`);
    } else if (doc.documentType === "receiving_confirmation") {
      assert.equal(movements, doc.lines.filter((l) => l.actualQuantity && l.actualQuantity.gt(0)).length,
        `receiving ${doc.id} movement count`);
    }
    assert.ok(await db.auditLog.count({ where: { targetId: doc.id, action: confirmAction[doc.documentType] } }) >= 1,
      `${doc.documentType} ${doc.id} missing confirm audit`);
    const outbox = await db.outboxMessage.count({ where: { aggregateId: doc.id } });
    if (doc.documentType === "partner_transfer") {
      assert.equal(outbox, 2, `${doc.documentType} ${doc.id} outbox count`);
    } else if (doc.documentType === "sale_record") {
      assert.equal(outbox, 1, `${doc.documentType} ${doc.id} outbox count`);
    } else if (doc.documentType === "receiving_confirmation") {
      assert.equal(outbox, 2, `receiving ${doc.id} outbox count`);
    } else if (doc.documentType !== "stocktake") {
      assert.ok(outbox >= 1, `${doc.documentType} ${doc.id} missing outbox`);
    }
  }
});

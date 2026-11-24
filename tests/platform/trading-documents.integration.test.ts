// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "../../platform/persistence/prisma";
import { createPrismaIdempotency } from "../../platform/http/idempotency";
import { runCommand } from "../../platform/http/pipeline";
import { tradingService, tradingUnitOfWork, tradingPorts, transferService, stocktakeService, saleService } from "../../composition/trading";
import { applyApprovalResult } from "../../composition/workflow";
import { createReceivingService, type ActualInput } from "../../contexts/trading/application/receivings";
import { listIssueSources } from "../../contexts/trading/application/issue-sources";
import { createCatalogRepos } from "../../contexts/catalog/infrastructure/prisma-repos";
import { createDocumentService } from "../../contexts/trading/application/documents";
import type { Actor } from "../../platform/identity/actor";
import type { TradingKind } from "../../contexts/trading/application/documents";
import { FlowableClient } from "../../platform/workflow/flowable-client";
import { createFlowableStarter } from "../../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../../platform/workflow/flowable-decider";
import { reconcileApproval } from "../../platform/workflow/reconciler";
import { recordDecisionIntent } from "../../platform/workflow/approval-service";
import type { OutboxMessage } from "../../platform/outbox/message";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import envelopeSchema from "../../contracts/events/envelope-v1.schema.json";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";
import { buildHandlerMap } from "../../composition/event-handlers";
import { approvalInbox } from "../../composition/approvals";

if (process.env.NEXORA_TEST_DB !== "1") throw new Error("Disposable PostgreSQL required");
const owner = new PrismaClient({ datasources: { db: { url: process.env.OWNER_DATABASE_URL! } } });
const db = getPrismaClient();
const warehouseId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), batchId = randomUUID();
const emptyBatchId = randomUUID();
const stockUomId = "aaaaaaaa-0001-4000-8000-000000000001";
const packUomId = randomUUID();
const orgId = randomUUID();
const actor: Actor = { userId: "receipt-creator", organizationId: "fixture-org", roles: ["staff"], unitIds: [warehouseId] };
process.env.NEXORA_ISSUER_INSTANCE_ID = "local-instance";
const partnerId = randomUUID();
const line = (quantity: string, uomId = stockUomId) => ({ warehouseId, productVariantId: variantId, batchId, quantity, uomId });
const countLine = (batch: string, countedQuantity: string, uomId = stockUomId) => ({
  warehouseId, productVariantId: variantId, batchId: batch, countedQuantity, uomId,
});

before(async () => {
  await owner.organization.create({ data: { id: orgId, instanceId: randomUUID(), code: "TEST", name: "Trading fixture" } });
  await owner.$executeRaw`INSERT INTO inventory.warehouse(id,code,name,status,created_by_sub)
    VALUES (${warehouseId}::uuid,${randomUUID()},'Test warehouse','active','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id,name,category_id,created_by_sub)
    VALUES (${productId}::uuid,'Test product','bbbbbbbb-0001-4000-8000-000000000001','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id,product_id,sku,created_by_sub)
    VALUES (${variantId}::uuid,${productId}::uuid,${randomUUID()},'fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.uom(id,code,name,name_key,kind)
    VALUES (${packUomId}::uuid,'PACK10','Pack','PACK10','count')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant_uom(id,product_variant_id,uom_id,is_stock_keeping,factor_to_stock_uom)
    VALUES (${randomUUID()}::uuid,${variantId}::uuid,${stockUomId}::uuid,true,1),
      (${randomUUID()}::uuid,${variantId}::uuid,${packUomId}::uuid,false,10)`;
  await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
    VALUES (${batchId}::uuid,${productId}::uuid,${variantId}::uuid,${randomUUID()},'issuer',${randomUUID()}::uuid,'available','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
    VALUES (${emptyBatchId}::uuid,${productId}::uuid,${variantId}::uuid,${randomUUID()},'issuer',${randomUUID()}::uuid,'available','fixture')`;
  for (const [sub, role] of [[actor.userId, "staff"], ["fixture-approver", "approver"]]) {
    const member = await owner.membership.create({ data: {
      id: randomUUID(), organizationId: orgId, keycloakSub: sub, displayName: sub, role, status: "active",
    } });
    await owner.membershipWarehouse.create({ data: { membershipId: member.id, warehouseId } });
  }
  await owner.partner.create({ data: { id: partnerId, issuerInstanceId: "remote-instance", code: randomUUID(),
    displayName: "Remote", createdBySub: "fixture" } });
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

async function stockCommand<T>(action: string, body: unknown,
  work: (ctx: Parameters<ReturnType<typeof stocktakeService>["create"]>[0]) => Promise<T>,
  key?: string, actingActor: Actor = actor): Promise<T> {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actingActor, resolveTenant: async () => actingActor.organizationId,
    action: `trading:stocktake:${action}`, unitOfWork: tradingUnitOfWork,
    method: "POST", routeKey: `stocktake:${action}`, payload: body,
    idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db),
    domain: (ctx) => work({ tx: ctx.tx, actor: actingActor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

async function saleCommand<T>(action: "create" | "confirm" | "cancel" | "read", body: unknown,
  work: (ctx: Parameters<ReturnType<typeof saleService>["create"]>[0]) => Promise<T>, key?: string,
  actingActor: Actor = actor): Promise<T> {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actingActor, resolveTenant: async () => actingActor.organizationId,
    action: `trading:sale:${action}`, unitOfWork: tradingUnitOfWork,
    method: "POST", routeKey: `sale:${action}`, payload: body,
    idempotencyKey: key, idempotencyPort: createPrismaIdempotency(db),
    domain: (ctx) => work({ tx: ctx.tx, actor: actingActor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

test("sale from approved issue leaves 6 to 4 balance unchanged, one trace event; rejects invalid source", {
  timeout: 120_000,
}, async () => {
  const lot = randomUUID();
  await owner.batch.create({ data: { id: lot, productId, productVariantId: variantId, localCode: randomUUID(),
    originIssuerInstanceId: "issuer", originLotId: randomUUID(), qualityStatus: "available", createdBySub: "fixture" } });
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [{ ...line("6"), batchId: lot }] }));
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: {
    warehouseId, batchId: lot } } })).quantity.toFixed(3), "6.000");
  const source = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "sale", lines: [{ ...line("2"), batchId: lot }] }), undefined, "goods_issue");
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id,
  })), { code: "ISSUE_NOT_CONFIRMED", httpStatus: 409 });
  const wrong = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "other", lines: [{ ...line("1"), batchId: lot }] }), undefined, "goods_issue");
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: wrong.id,
  })), { code: "ISSUE_WRONG_PURPOSE", httpStatus: 422 });
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: randomUUID(),
  })), { code: "ISSUE_NOT_FOUND", httpStatus: 422 });
  await command("submit", { id: source.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", source.id, "submit", source.version), undefined, "goods_issue");
  await approve(source.id);
  await command("confirm", { id: source.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", source.id, "confirm", source.version + 2), randomUUID(), "goods_issue");
  const balance = async () => (await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: {
    warehouseId, batchId: lot } } })).quantity.toFixed(3);
  assert.equal(await balance(), "4.000");
  const movementCount = await db.stockMovement.count();
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id, soldAt: new Date(Date.now() + 86_400_000).toISOString(),
  })), { code: "INVALID_SOLD_AT", httpStatus: 422 });
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id, buyerRef: "x".repeat(65),
  })), { code: "BUYER_REF_TOO_LONG", httpStatus: 422 });
  const cancelled = await saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id, buyerRef: "  ref-1  ",
  }));
  assert.equal(cancelled.buyerRef, "ref-1");
  assert.equal(cancelled.lines[0]!.sourceIssueLineId, source.lines[0]!.id);
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id,
  })), { code: "SALE_ALREADY_EXISTS", httpStatus: 409 });
  await saleCommand("cancel", { id: cancelled.id }, (ctx) => saleService().cancel(ctx, cancelled.id, cancelled.version));
  const sale = await saleCommand("create", {}, (ctx) => saleService().create(ctx, { linkedIssueId: source.id }));
  await assert.rejects(saleCommand("confirm", { id: sale.id }, (ctx) =>
    saleService().confirm(ctx, sale.id, sale.version), randomUUID(), { ...actor, unitIds: [] }),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
  const key = randomUUID();
  const confirm = () => saleCommand("confirm", { id: sale.id }, (ctx) => saleService().confirm(ctx, sale.id, sale.version), key);
  const posted = await confirm();
  assert.deepEqual(await confirm(), posted);
  assert.equal(posted.movementIds.length, 0);
  assert.equal(await balance(), "4.000");
  assert.equal(await db.stockMovement.count(), movementCount);
  assert.deepEqual((await saleCommand("read", {}, (ctx) => saleService().view(ctx, sale.id))).lines[0]!.stockEffect,
    { issueBefore: "6.000", issueAfter: "4.000" });
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: sale.id, eventType: "trading.sale.recorded.v1" } }), 1);
  assert.equal((await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: sale.id,
    eventType: "trading.sale.recorded.v1" } })).destination, "traceability");
  await assert.rejects(saleCommand("create", {}, (ctx) => saleService().create(ctx, {
    linkedIssueId: source.id,
  })), { code: "SALE_ALREADY_EXISTS", httpStatus: 409 });
});

test("stocktake signed variance, zero lines, found stock, packing, reason and replay", async () => {
  const lot = randomUUID(), found = randomUUID();
  for (const id of [lot, found]) await owner.batch.create({ data: { id, productId, productVariantId: variantId,
    localCode: randomUUID(), originIssuerInstanceId: "issuer", originLotId: randomUUID(),
    qualityStatus: "available", createdBySub: "fixture" } });
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [{ ...line("10"), batchId: lot }] }));
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  const first = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(lot, "7"), countLine(found, "5")], note: "Counted variance",
  }));
  assert.equal((await db.documentLine.findFirstOrThrow({ where: { documentId: first.id } })).quantity, null);
  const key = randomUUID();
  const confirm = () => stockCommand("confirm", { id: first.id }, (ctx) =>
    stocktakeService().confirm(ctx, first.id, first.version), key);
  const posted = await confirm();
  assert.deepEqual(await confirm(), posted);
  assert.equal(posted.movementIds.length, 2);
  assert.deepEqual((await db.stockMovement.findMany({ where: { sourceLineId: { in: first.lines.map((l) => l.id) } },
    orderBy: { delta: "asc" } })).map((row) => row.delta.toFixed(3)), ["-3.000", "5.000"]);
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: {
    warehouseId, batchId: lot } } })).quantity.toFixed(3), "7.000");
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: {
    warehouseId, batchId: found } } })).quantity.toFixed(3), "5.000");
  const second = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(lot, "0.9", packUomId), countLine(found, "5")], note: "Two found",
  }));
  await stockCommand("confirm", { id: second.id }, (ctx) => stocktakeService().confirm(ctx, second.id, second.version), randomUUID());
  const event = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: second.id,
    eventType: "trading.stocktake.confirmed.v1" } });
  const payload = event.payload as { lines: { delta: string; systemQuantity: string; countedQuantity: string }[] };
  assert.deepEqual(payload.lines.map((item) => item.delta), ["2.000", "0.000"]);
  assert.equal(payload.lines[0]!.systemQuantity, "7.000");
  assert.equal(payload.lines[0]!.countedQuantity, "9.000");
  assert.equal((await db.documentLine.findFirstOrThrow({ where: { documentId: second.id } })).quantity, null);
  assert.equal((await db.documentLine.findFirstOrThrow({ where: { documentId: second.id } })).uomId, stockUomId);
  assert.equal((await stockCommand("read", {}, (ctx) => stocktakeService().view(ctx, second.id))).lines[1]!.movementId, null);
  const zero = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(lot, "9"), countLine(found, "5")],
  }));
  assert.equal((await stockCommand("confirm", { id: zero.id }, (ctx) => stocktakeService().confirm(ctx, zero.id, zero.version), randomUUID())).movementIds.length, 0);
  assert.equal((await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: zero.id,
    eventType: "trading.stocktake.confirmed.v1" } })).destination, "traceability");
  assert.equal((await db.stockMovement.count({ where: { sourceLineId: { in: zero.lines.map((row) => row.id) } } })), 0);
  const noReason = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, { lines: [countLine(lot, "8")] }));
  await assert.rejects(stockCommand("confirm", { id: noReason.id }, (ctx) =>
    stocktakeService().confirm(ctx, noReason.id, noReason.version), randomUUID()),
  { code: "STOCKTAKE_REASON_REQUIRED", httpStatus: 422 });
  await assert.rejects(stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(lot, "1"), countLine(lot, "2")],
  })), { code: "DUPLICATE_LINE", httpStatus: 422 });
  await assert.rejects(stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(randomUUID(), "1")],
  })), { code: "BATCH_NOT_FOUND", httpStatus: 422 });
  const duplicatePatch = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
    lines: [countLine(lot, "9")],
  }));
  await assert.rejects(stockCommand("update", { id: duplicatePatch.id }, (ctx) =>
    stocktakeService().edit(ctx, duplicatePatch.id, duplicatePatch.version,
      { lines: [countLine(lot, "8"), countLine(lot, "9")] })),
  { code: "DUPLICATE_LINE", httpStatus: 422 });
  const race = await Promise.allSettled([randomUUID(), randomUUID()].map((raceKey) =>
    stockCommand("confirm", { id: duplicatePatch.id }, (ctx) =>
      stocktakeService().confirm(ctx, duplicatePatch.id, duplicatePatch.version), raceKey)));
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await db.outboxMessage.count({ where: { aggregateId: duplicatePatch.id,
    eventType: "trading.stocktake.confirmed.v1" } })), 1);
  await owner.batch.update({ where: { id: lot }, data: { expiresOn: new Date(Date.now() - 86400000), qualityStatus: "inspect" } });
  try {
    const expired = await stockCommand("create", {}, (ctx) => stocktakeService().create(ctx, {
      lines: [countLine(lot, "9")],
    }));
    await stockCommand("confirm", { id: expired.id }, (ctx) => stocktakeService().confirm(ctx, expired.id, expired.version), randomUUID());
  } finally { await owner.batch.update({ where: { id: lot }, data: { expiresOn: null, qualityStatus: "available" } }); }
  await assert.rejects(stockCommand("confirm", { id: noReason.id }, (ctx) =>
    stocktakeService().confirm(ctx, noReason.id, noReason.version), randomUUID(), { ...actor, unitIds: [] }),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
});

test("receipt 20 from pack, atomic movement, audit, outbox, replay and stale guard", async () => {
  const receipt = await command("create", { lines: [line("2", packUomId)] }, (ctx) =>
    tradingService.create(ctx, "goods_receipt", { lines: [line("2", packUomId)] }));
  assert.equal(receipt.lines[0]!.quantity, "2.000");
  assert.equal(receipt.lines[0]!.stockQuantity, "20.000");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: receipt.lines[0]!.id } }), 0);
  const input = { id: receipt.id, version: receipt.version };
  const key = randomUUID();
  const confirm = () => command("confirm", input, (ctx) =>
    tradingService.action(ctx, "goods_receipt", receipt.id, "confirm", receipt.version), key);
  const first = await confirm();
  assert.equal(first.status, "confirmed");
  assert.equal(first.version, receipt.version + 1);
  assert.equal(first.movementIds?.length, 1);
  assert.deepEqual(await confirm(), first);
  await assert.rejects(command("confirm", { ...input, version: -1 }, (ctx) =>
    tradingService.action(ctx, "goods_receipt", receipt.id, "confirm", receipt.version), key),
  { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), "20.000");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: receipt.lines[0]!.id } }), 1);
  const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceLineId: receipt.lines[0]!.id } });
  await assert.rejects(db.stockMovement.create({ data: { ...movement, id: randomUUID() } }), { code: "P2002" });
  assert.equal(await db.auditLog.count({ where: { targetId: receipt.id, action: "trading.document.confirm" } }), 1);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: receipt.id,
    eventType: "trading.receipt.confirmed.v1" } }), 1);
  await assert.rejects(command("confirm", input, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID()), { code: "VERSION_CONFLICT" });
  await assert.rejects(command("edit", input, (ctx) => tradingService.edit(ctx,
    "goods_receipt", receipt.id, receipt.version, { note: "stale" })), { code: "VERSION_CONFLICT" });
});

test("issue submit creates one bridge request; unapproved confirm fails; cancel tombstones request", async () => {
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line("3"), line("2")] }));
  const issue = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "other", lines: [line("12"), line("12")] }), undefined, "goods_issue");
  const input = { id: issue.id, version: issue.version };
  const submit = () => command("submit", input, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "submit", issue.version), "same-submit-key-00000000001", "goods_issue");
  assert.equal((await submit()).status, "pending_approval");
  assert.equal((await submit()).status, "pending_approval");
  const approval = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: issue.id } });
  assert.equal(approval.state, "requested");
  assert.equal(await db.approvalRequest.count({ where: { documentId: issue.id } }), 1);
  assert.equal((await db.documentLine.findFirstOrThrow({ where: { documentId: issue.id } })).uomId, stockUomId);
  await assert.rejects(command("confirm", input, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "confirm", issue.version), undefined, "goods_issue"), { code: "VERSION_CONFLICT" });
  await assert.rejects(command("confirm", { ...input, version: issue.version + 1 }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "confirm", issue.version + 1), undefined, "goods_issue"), { code: "WRONG_STATE" });
  const cancelled = await command("cancel", {}, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "cancel", issue.version + 1), undefined, "goods_issue");
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { documentId: issue.id } })).state, "cancelled");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: issue.lines.map((l) => l.id) } } }), 0);
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: receipt.id } })).status, "draft");
});

test("third movement failure rolls back earlier movements, balance, status, audit and outbox", async () => {
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line("1"), line("1"), line("1")] }));
  let calls = 0;
  const fault = createDocumentService({ ...tradingPorts, async adjust(tx, input) {
    if (++calls === 3) throw new Error("injected third movement failure");
    return tradingPorts.adjust(tx, input);
  } });
  const balanceBefore = (await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3);
  await assert.rejects(command("confirm", { id: receipt.id }, (ctx) =>
    fault.action(ctx, "goods_receipt", receipt.id, "confirm", receipt.version)),
  /injected third movement failure/);
  assert.equal(calls, 3);
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: receipt.id } })).status, "draft");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: receipt.lines.map((row) => row.id) } } }), 0);
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), balanceBefore);
  assert.equal(await db.auditLog.count({ where: { targetId: receipt.id, action: "trading.document.confirm" } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: receipt.id } }), 0);
});

async function approve(id: string, decision: "approved" | "rejected" = "approved") {
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
  if (decision === "approved") {
    await assert.rejects(db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
      approvalRequestId: row.id, actorSub: actor.userId, decision, flowableTaskId: task.id,
      expectedVersion: row.version,
    })), { code: "APPROVAL_SCOPE" });
  }
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: "fixture-approver", decision,
    ...(decision === "rejected" ? { reason: "Rejected by approver" } : {}),
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
    if (state === decision) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Decision was not reconciled before timeout");
}

async function issue(quantity: string, count = 1, purpose: "other" | "partner_transfer" = "other") {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose, lines: Array.from({ length: count }, () => line(quantity)) }), undefined, "goods_issue");
  await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
  await approve(doc.id);
  return { ...doc, version: doc.version + 2 };
}

test("P08 explicit issue allocation keeps two confirmed receipt sources and rejects overclaim", {
  timeout: 120_000,
}, async () => {
  const lot = randomUUID();
  await owner.batch.create({ data: { id: lot, productId, productVariantId: variantId,
    localCode: randomUUID(), originIssuerInstanceId: "issuer", originLotId: randomUUID(),
    qualityStatus: "available", createdBySub: "fixture" } });
  const receipts: { id: string; version: number; lines: { id: string }[] }[] = [];
  for (let index = 0; index < 2; index++) {
    const receipt = await command("create", {}, (ctx) => tradingService.create(ctx,
      "goods_receipt", { lines: [{ ...line("5"), batchId: lot }] }));
    await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
      "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
    receipts.push(receipt);
  }
  const sources = [{ sourceLineId: receipts[0]!.lines[0]!.id, quantity: "2" },
    { sourceLineId: receipts[1]!.lines[0]!.id, quantity: "4" }];
  await assert.rejects(command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_issue", { purpose: "other", lines: [{ ...line("6"), batchId: lot,
      sources: [{ ...sources[0], quantity: "1" }] }] }), undefined, "goods_issue"),
  { code: "ISSUE_SOURCE_INCOMPLETE" });
  await assert.rejects(command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_issue", { purpose: "other", lines: [{ ...line("1"), batchId,
      sources: [{ sourceLineId: receipts[0]!.lines[0]!.id, quantity: "1" }] }] }),
  undefined, "goods_issue"), { code: "ISSUE_SOURCE_INVALID" });
  const draft = await command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_issue", { purpose: "other", lines: [{ ...line("6"), batchId: lot,
      sources }] }), undefined, "goods_issue");
  const issue = await command("edit", { id: draft.id }, (ctx) => tradingService.edit(ctx,
    "goods_issue", draft.id, draft.version, { lines: [{ ...line("6"), batchId: lot,
      sources }] }), undefined, "goods_issue");
  assert.equal(await db.issueSourceAllocation.count({ where: { issueLineId: draft.lines[0]!.id } }), 0);
  assert.deepEqual(issue.lines[0]!.sources.map((row) => row.quantity), ["2.000", "4.000"]);
  await command("submit", { id: issue.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "submit", issue.version), undefined, "goods_issue");
  await approve(issue.id);
  await command("confirm", { id: issue.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", issue.id, "confirm", issue.version + 2), randomUUID(), "goods_issue");
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: {
    warehouseId, batchId: lot } } })).quantity.toFixed(3), "4.000");
  assert.equal(await db.issueSourceAllocation.count({ where: { issueLineId: issue.lines[0]!.id } }), 2);
  const options = await listIssueSources(db, actor, lot, warehouseId);
  assert.equal(options.items.find((row) => row.sourceLineId === receipts[0]!.lines[0]!.id)?.availableQuantity,
    "3.000");
  assert.equal(options.items.find((row) => row.sourceLineId === receipts[1]!.lines[0]!.id)?.availableQuantity,
    "1.000");
  await assert.rejects(listIssueSources(db, { ...actor, unitIds: [] }, lot, warehouseId),
    { code: "WAREHOUSE_SCOPE_REQUIRED" });
  const over = await command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_issue", { purpose: "other", lines: [{ ...line("4"), batchId: lot,
      sources: [{ sourceLineId: receipts[0]!.lines[0]!.id, quantity: "4" }] }] }),
  undefined, "goods_issue");
  await command("submit", { id: over.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", over.id, "submit", over.version), undefined, "goods_issue");
  await approve(over.id);
  await assert.rejects(command("confirm", { id: over.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", over.id, "confirm", over.version + 2), randomUUID(), "goods_issue"),
  { code: "ISSUE_SOURCE_OVERALLOCATED", httpStatus: 409 });
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: over.id } })).status, "approved");
});

test("approved issue 12 posts once; two issues race for remaining stock with real bridge decisions",
  { timeout: 120_000 }, async () => {
    const first = await issue("12", 1, "partner_transfer");
    const confirmed = await command("confirm", { id: first.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", first.id, "confirm", first.version), randomUUID(), "goods_issue");
    assert.equal(confirmed.status, "confirmed");
    assert.equal(await db.auditLog.count({ where: { targetId: first.id, action: "trading.document.confirm" } }), 1);
    assert.equal(await db.outboxMessage.count({ where: { aggregateId: first.id,
      eventType: "trading.issue.confirmed.v1" } }), 1);
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), "8.000");
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: first.lines[0]!.id } }), 1);
    const transfer = await transferCommand("create", { linkedIssueId: first.id, destinationPartnerId: partnerId },
      (ctx) => transferService().create(ctx, { linkedIssueId: first.id, destinationPartnerId: partnerId }));
    const movementCount = await db.stockMovement.count();
    await transferCommand("confirm", { id: transfer.id },
      (ctx) => transferService().confirm(ctx, transfer.id, transfer.version), randomUUID());
    assert.equal(await db.stockMovement.count(), movementCount);
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), "8.000");
    assert.equal(await db.outboxMessage.count({ where: { aggregateId: transfer.id,
      eventType: "transfer.announced.v1" } }), 1);
    const replenishment = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
      { lines: [line("12")] }));
    await command("confirm", { id: replenishment.id }, (ctx) => tradingService.action(ctx,
      "goods_receipt", replenishment.id, "confirm", replenishment.version), randomUUID());
    const second = await issue("12");
    const third = await issue("12");
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const racing = createDocumentService({ ...tradingPorts, async confirmApproval(tx, input) {
      await tradingPorts.confirmApproval(tx, input);
      if (++entered === 2) release();
      await barrier;
    } });
    const race = await Promise.allSettled([second, third].map((doc) => command("confirm", { id: doc.id },
      (ctx) => racing.action(ctx, "goods_issue", doc.id, "confirm", doc.version),
      randomUUID(), "goods_issue")));
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(race.filter((result) => result.status === "rejected" &&
      result.reason.code === "INSUFFICIENT_STOCK").length, 1);
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), "8.000");
    for (const doc of [second, third]) {
      const status = (await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status;
      assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }),
        status === "confirmed" ? 1 : 0);
    }
  });

test("two lines of 5 on same batch fail against total balance 8, without partial postings",
  { timeout: 120_000 }, async () => {
    const doc = await issue("5", 2);
    const before = (await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3);
    await assert.rejects(command("confirm", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "confirm", doc.version), randomUUID(), "goods_issue"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INSUFFICIENT_STOCK" &&
      "requested" in error && error.requested === "10.000" &&
      "available" in error && error.available === "8.000");
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), before);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "approved");
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: doc.lines.map((row) => row.id) } } }), 0);
  });

test("approved request cancels atomically; stock UOM is frozen after submit despite packing-factor edits",
  { timeout: 120_000 }, async () => {
    const cancelled = await issue("1");
    await command("cancel", { id: cancelled.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", cancelled.id, "cancel", cancelled.version), undefined, "goods_issue");
    assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { documentId: cancelled.id } })).state, "cancelled");
    const packed = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
      { purpose: "other", lines: [line("0.5", packUomId)] }), undefined, "goods_issue");
    await command("submit", { id: packed.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", packed.id, "submit", packed.version), undefined, "goods_issue");
    const normalized = await db.documentLine.findFirstOrThrow({ where: { documentId: packed.id } });
    assert.equal(normalized.quantity?.toFixed(3), "5.000");
    assert.equal(normalized.uomId, stockUomId);
    await owner.productVariantUom.update({ where: {
      productVariantId_uomId: { productVariantId: variantId, uomId: packUomId },
    }, data: { factorToStockUom: "20" } });
    await approve(packed.id);
    const confirmed = await command("confirm", { id: packed.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", packed.id, "confirm", packed.version + 2), randomUUID(), "goods_issue");
    assert.equal(confirmed.status, "confirmed");
    assert.equal((await db.stockMovement.findUniqueOrThrow({ where: { sourceLineId_kind: {
      sourceLineId: normalized.id, kind: "issue",
    } } })).delta.toFixed(3), "-5.000");
  });

test("issue with third line on empty balance fails 422, leaves approved document and earlier balances untouched",
  { timeout: 120_000 }, async () => {
    const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
      purpose: "other", lines: [line("1"), line("1"), { ...line("1"), batchId: emptyBatchId }],
    }), undefined, "goods_issue");
    await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
    await approve(doc.id);
    const before = (await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3);
    const retryKey = randomUUID();
    await assert.rejects(command("confirm", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "confirm", doc.version + 2), retryKey, "goods_issue"),
    (err: unknown) => err instanceof Error && "code" in err && err.code === "INSUFFICIENT_STOCK" &&
      "batchId" in err && err.batchId === emptyBatchId);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "approved");
    assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { documentId: doc.id } })).state, "approved");
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: doc.lines.map((row) => row.id) } } }), 0);
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), before);
    assert.equal(await db.outboxMessage.count({ where: { aggregateId: doc.id,
      eventType: "trading.issue.confirmed.v1" } }), 0);
    const supply = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt", {
      lines: [{ ...line("1"), batchId: emptyBatchId }],
    }));
    await command("confirm", { id: supply.id }, (ctx) => tradingService.action(ctx,
      "goods_receipt", supply.id, "confirm", supply.version), randomUUID());
    const retry = await command("confirm", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "confirm", doc.version + 2), retryKey, "goods_issue");
    assert.equal(retry.status, "confirmed");
    assert.equal(retry.movementIds?.length, 3);
  });

test("expired and quarantined batches reject receipt confirmation with typed 422 errors", async () => {
  const draft = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt",
    { lines: [line("1")] }));
  await owner.batch.update({ where: { id: batchId }, data: {
    expiresOn: new Date(Date.now() - 86_400_000),
  } });
  try {
    await assert.rejects(command("confirm", { id: draft.id }, (ctx) => tradingService.action(ctx,
      "goods_receipt", draft.id, "confirm", draft.version)), { code: "BATCH_EXPIRED", httpStatus: 422 });
    await owner.batch.update({ where: { id: batchId }, data: { expiresOn: null, qualityStatus: "inspect" } });
    await assert.rejects(command("confirm", { id: draft.id }, (ctx) => tradingService.action(ctx,
      "goods_receipt", draft.id, "confirm", draft.version)), { code: "BATCH_QUALITY_BLOCKED", httpStatus: 422 });
  } finally {
    await owner.batch.update({ where: { id: batchId }, data: { expiresOn: null, qualityStatus: "available" } });
  }
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: draft.id } })).status, "draft");
});

test("two reversed multi-batch issues lock in same order and only one can confirm", { timeout: 120_000 }, async () => {
  const receipt = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt", {
    lines: [line("20"), { ...line("20"), batchId: emptyBatchId }],
  }));
  await command("confirm", { id: receipt.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", receipt.id, "confirm", receipt.version), randomUUID());
  const make = async (reversed: boolean) => {
    const lines = [line("12"), { ...line("12"), batchId: emptyBatchId }];
    const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
      purpose: "other", lines: reversed ? lines.reverse() : lines,
    }), undefined, "goods_issue");
    await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
    await approve(doc.id);
    return { ...doc, version: doc.version + 2 };
  };
  const [first, second] = await Promise.all([make(false), make(true)]);
  let ready = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const racing = createDocumentService({ ...tradingPorts, async confirmApproval(tx, input) {
    await tradingPorts.confirmApproval(tx, input);
    if (++ready === 2) release();
    await barrier;
  } });
  const results = await Promise.allSettled([first, second].map((doc) => command("confirm", { id: doc.id },
    (ctx) => racing.action(ctx, "goods_issue", doc.id, "confirm", doc.version), randomUUID(), "goods_issue")));
  assert.equal(results.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(results.filter((outcome) => outcome.status === "rejected" &&
    outcome.reason.code === "INSUFFICIENT_STOCK").length, 1);
  for (const doc of [first, second]) {
    const persisted = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(persisted.version, persisted.status === "confirmed" ? doc.version + 1 : doc.version);
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: { in: doc.lines.map((row) => row.id) } } }),
      persisted.status === "confirmed" ? 2 : 0);
  }
});

test("draft may be empty, edit uses one version increment, rejects wrong batch and scope", async () => {
  const draft = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt", { lines: [] }));
  await assert.rejects(command("confirm", { id: draft.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", draft.id, "confirm", draft.version)), { code: "NO_LINES", httpStatus: 422 });
  const edited = await command("edit", { id: draft.id }, (ctx) => tradingService.edit(ctx,
    "goods_receipt", draft.id, draft.version, { lines: [line("1")], note: "Loaded" }));
  assert.equal(edited.version, draft.version + 1);
  assert.equal(edited.note, "Loaded");
  await assert.rejects(command("edit", {}, (ctx) => tradingService.edit(ctx,
    "goods_receipt", draft.id, draft.version, { note: "stale" })), { code: "VERSION_CONFLICT" });
  await assert.rejects(command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_receipt", { lines: [{ ...line("1"), batchId: randomUUID() }] })),
  { code: "BATCH_PRODUCT_MISMATCH", httpStatus: 422 });
  await assert.rejects(command("create", {}, (ctx) => tradingService.create(ctx,
    "goods_receipt", { lines: [line("1")] }), undefined, "goods_receipt",
  { ...actor, unitIds: [] }), { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
});

test("rejected bridge decision never permits issue movement", { timeout: 120_000 }, async () => {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
    purpose: "other", lines: [line("1")],
  }), undefined, "goods_issue");
  await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
  await approve(doc.id, "rejected");
  await assert.rejects(command("confirm", { id: doc.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", doc.id, "confirm", doc.version + 2), randomUUID(), "goods_issue"),
  { code: "WRONG_STATE", httpStatus: 409 });
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
});

test("reconciliation is atomic, duplicate delivery is inert, conflicting late result is audited", {
  timeout: 120_000,
}, async () => {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
    purpose: "other", lines: [line("1")],
  }), undefined, "goods_issue");
  await command("submit", {}, (ctx) => tradingService.action(ctx, "goods_issue", doc.id, "submit", doc.version),
    undefined, "goods_issue");
  await approve(doc.id, "rejected");
  const row = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: doc.id } });
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "rejected");
  const audits = await db.auditLog.count({ where: { targetId: row.id, action: "workflow.reconcile.synced" } });
  await reconcileApproval(db, FlowableClient.fromEnv(), row.id, applyApprovalResult);
  assert.equal(await db.auditLog.count({ where: { targetId: row.id, action: "workflow.reconcile.synced" } }), audits);
  const engine = FlowableClient.fromEnv();
  const history = await engine.getHistory(row.flowableProcessId!);
  const conflicting = Object.create(engine) as FlowableClient;
  conflicting.getHistory = async () => ({ ...history, variables: history.variables.map((variable) =>
    variable.name === "decision" ? { ...variable, value: "approved" } : variable) });
  await reconcileApproval(db, conflicting, row.id, applyApprovalResult);
  await reconcileApproval(db, conflicting, row.id, applyApprovalResult);
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "rejected");
  assert.equal(await db.auditLog.count({ where: { targetId: row.id,
    action: "workflow.approval.late_result_ignored" } }), 1);
  await assert.rejects(command("confirm", {}, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "confirm", doc.version + 2), randomUUID(), "goods_issue"),
  { code: "WRONG_STATE", httpStatus: 409 });
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
});

test("cancel supersedes an unsent decision intent", { timeout: 120_000 }, async () => {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
    purpose: "other", lines: [line("1")],
  }), undefined, "goods_issue");
  await command("submit", {}, (ctx) => tradingService.action(ctx, "goods_issue", doc.id, "submit", doc.version),
    undefined, "goods_issue");
  const engine = FlowableClient.fromEnv();
  const requested = await db.outboxMessage.findFirstOrThrow({ where: { aggregateType: "approval_request",
    eventType: "workflow.approval.requested.v1", payload: { path: ["documentId"], equals: doc.id } } });
  await createFlowableStarter(db, engine)(requested as OutboxMessage);
  const row = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: doc.id } });
  const task = (await engine.queryTasks({ processInstanceId: row.flowableProcessId! }))[0]!;
  const resolver = async (sub: string) => ({ sub, active: true, role: "approver", warehouseIds: [warehouseId] });
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: "fixture-approver", decision: "approved",
    flowableTaskId: task.id, expectedVersion: row.version,
  }));
  const message = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: row.id,
    eventType: "workflow.approval.decision_requested.v1", aggregateVersion: intent.version } });
  await command("cancel", {}, (ctx) => tradingService.action(ctx, "goods_issue", doc.id,
    "cancel", doc.version + 1), undefined, "goods_issue");
  await createFlowableDecider(db, engine, resolver)(message as OutboxMessage);
  assert.equal((await engine.getTask(task.id)).id, task.id);
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state, "cancelled");
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "cancelled");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
});

test("engine outage preserves submit and intent; recovery converges without stock before confirm", {
  timeout: 120_000,
}, async () => {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
    purpose: "other", lines: [line("1")],
  }), undefined, "goods_issue");
  await command("submit", {}, (ctx) => tradingService.action(ctx, "goods_issue", doc.id,
    "submit", doc.version), undefined, "goods_issue");
  const row = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: doc.id } });
  const request = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: row.id,
    eventType: "workflow.approval.requested.v1" } });
  const engine = FlowableClient.fromEnv();
  const down = new FlowableClient({ baseUrl: process.env.FLOWABLE_BASE_URL!, user: "unavailable",
    password: "unavailable" }, async () => { throw new Error("Engine unavailable"); });
  await assert.rejects(createFlowableStarter(db, down)(request as OutboxMessage));
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "pending_approval");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
  await createFlowableStarter(db, engine)(request as OutboxMessage);
  await reconcileApproval(db, engine, row.id, applyApprovalResult);
  const pending = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
  const resolver = async (sub: string) => ({ sub, active: true, role: "approver", warehouseIds: [warehouseId] });
  const intent = await db.$transaction((tx) => recordDecisionIntent(tx, resolver, {
    approvalRequestId: row.id, actorSub: "fixture-approver", decision: "approved",
    flowableTaskId: pending.flowableTaskId!, expectedVersion: pending.version,
  }));
  const message = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: row.id,
    eventType: "workflow.approval.decision_requested.v1", aggregateVersion: intent.version } });
  await assert.rejects(createFlowableDecider(db, down, resolver)(message as OutboxMessage));
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state, "decision_pending");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
  await createFlowableDecider(db, engine, resolver)(message as OutboxMessage);
  await reconcileApproval(db, engine, row.id, applyApprovalResult);
  assert.equal((await engine.findInstances(row.id)).length, 1);
  assert.equal((await engine.getHistory(pending.flowableProcessId!)).endActivityIds.includes("approvedEnd"), true);
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state, "approved");
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "approved");
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
});

test("isolated engine upgrade keeps v1 and v2 decisions bound to their own issue", {
  timeout: 120_000,
}, async () => {
  const engine = FlowableClient.fromEnv();
  const make = async () => {
    const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
      purpose: "other", lines: [line("1")],
    }), undefined, "goods_issue");
    await command("submit", {}, (ctx) => tradingService.action(ctx, "goods_issue", doc.id,
      "submit", doc.version), undefined, "goods_issue");
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { documentId: doc.id } });
    const message = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: row.id,
      eventType: "workflow.approval.requested.v1" } });
    await createFlowableStarter(db, engine)(message as OutboxMessage);
    await reconcileApproval(db, engine, row.id, applyApprovalResult);
    return { doc, row: await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } }) };
  };
  const first = await make();
  assert.equal(first.row.flowableDefinitionVersion, 1);
  const source = readFileSync("deploy/flowable/processes/goods-issue-approval.bpmn20.xml", "utf8");
  const fixture = source.replace('name="Goods Issue Approval"', 'name="Goods Issue Approval v2"');
  assert.notEqual(fixture, source);
  const form = new FormData();
  form.set("deploymentName", "fixture-goods-issue-v2");
  form.set("file", new Blob([fixture], { type: "application/xml" }), "goods-issue-approval.bpmn20.xml");
  const deployed = await fetch(`${process.env.FLOWABLE_BASE_URL}/repository/deployments`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${process.env.FLOWABLE_ADMIN_USER}:${process.env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64")}` },
    body: form,
  });
  assert.equal(deployed.status, 201);
  const second = await make();
  assert.equal(second.row.flowableDefinitionVersion, 2);
  const inbox = await approvalInbox({ userId: "fixture-approver", organizationId: "fixture-org",
    roles: ["approver"], unitIds: [warehouseId] });
  assert.ok([first, second].every(({ row }) => inbox.some((item) => item.approvalRequestId === row.id)));
  for (const { doc, row } of [first, second]) {
    const history = await engine.getHistory(row.flowableProcessId!);
    assert.equal((await engine.getDefinition(history.processDefinitionId)).version, row.flowableDefinitionVersion);
    await approve(doc.id);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "approved");
    assert.equal((await engine.getHistory(row.flowableProcessId!)).endActivityIds.includes("approvedEnd"), true);
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
  }
});

test("concurrent receipt confirms on same document return one 409, not a raw immutable-line error", async () => {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt", {
    lines: [line("1", packUomId)],
  }));
  const results = await Promise.allSettled([0, 1].map(() => command("confirm", { id: doc.id },
    (ctx) => tradingService.action(ctx, "goods_receipt", doc.id, "confirm", doc.version), randomUUID())));
  assert.equal(results.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(results.filter((outcome) => outcome.status === "rejected" &&
    outcome.reason.code === "VERSION_CONFLICT").length, 1);
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 1);
});

async function transferIssue() {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "partner_transfer", lines: [line("1")] }), undefined, "goods_issue");
  await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
  await approve(doc.id);
  await command("confirm", { id: doc.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "confirm", doc.version + 2), randomUUID(), "goods_issue");
  return doc;
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

test("transfer copies all issue lines; cancellation frees issue without deleting history", { timeout: 120_000 }, async () => {
  const issue = await transferIssue();
  const service = transferService();
  const input = { linkedIssueId: issue.id, destinationPartnerId: partnerId };
  const first = await transferCommand("create", input, (ctx) => service.create(ctx, input));
  assert.equal(first.lines.length, issue.lines.length);
  assert.equal(first.lines[0]!.sourceIssueLineId, issue.lines[0]!.id);
  assert.equal(first.lines[0]!.quantity, "1.000");
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: first.id } }), 0);
  await assert.rejects(transferCommand("create", input, (ctx) => service.create(ctx, input)),
    { code: "TRANSFER_ALREADY_EXISTS", httpStatus: 409 });
  await transferCommand("cancel", { id: first.id }, (ctx) => service.cancel(ctx, first.id, first.version));
  const next = await transferCommand("create", input, (ctx) => service.create(ctx, input));
  assert.notEqual(next.id, first.id);
  assert.equal((await db.transferDetail.findMany({ where: { linkedIssueId: issue.id } })).length, 2);
  const confirmed = await transferCommand("confirm", { id: next.id, version: next.version },
    (ctx) => service.confirm(ctx, next.id, next.version), randomUUID());
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(confirmed.movementIds, []);
  const announcement = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: next.id } });
  assert.equal(announcement.eventType, "transfer.announced.v1");
  assert.equal(announcement.status, "pending");
  assert.equal(announcement.nextAttemptAt.getUTCFullYear(), 9999);
});

test("offline dispatcher retains frozen envelope; replay and concurrency never duplicate", { timeout: 120_000 }, async () => {
  const issue = await transferIssue();
  const service = transferService();
  const input = { linkedIssueId: issue.id, destinationPartnerId: partnerId };
  const outcomes = await Promise.allSettled([0, 1].map(() =>
    transferCommand("create", input, (ctx) => service.create(ctx, input), randomUUID())));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected" &&
    outcome.reason.code === "TRANSFER_ALREADY_EXISTS").length, 1);
  const doc = (outcomes.find((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<
    Awaited<ReturnType<typeof service.create>>>).value;
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: doc.id } }), 0);
  const before = await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: { warehouseId, batchId } } });
  const movements = await db.stockMovement.count();
  const payload = { id: doc.id, version: doc.version };
  const key = randomUUID();
  const confirm = () => transferCommand("confirm", payload, (ctx) => service.confirm(ctx, doc.id, doc.version), key);
  const first = await confirm();
  assert.deepEqual(await confirm(), first);
  await assert.rejects(transferCommand("confirm", payload,
    (ctx) => service.confirm(ctx, doc.id, doc.version), randomUUID()), { code: "VERSION_CONFLICT", httpStatus: 409 });
  await assert.rejects(transferCommand("create", input, (ctx) => service.create(ctx, input)),
    { code: "TRANSFER_ALREADY_EXISTS", httpStatus: 409 });
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(), before.quantity.toFixed());
  assert.equal(await db.stockMovement.count(), movements);
  const rows = await db.outboxMessage.findMany({ where: { aggregateId: doc.id } });
  assert.equal(rows.length, 2);
  const row = rows.find((entry) => entry.eventType === "transfer.announced.v1")!;
  assert.equal(rows.find((entry) => entry.eventType === "trading.transfer.confirmed.v1")?.destination,
    "traceability");
  const envelope = row.payload as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.equal(ajv.validate(envelopeSchema, envelope), true, ajv.errorsText());
  assert.equal(envelope.recipientInstanceId, "remote-instance");
  assert.equal(envelope.linkedIssueId, issue.id);
  assert.equal(envelope.sentQuantity, "1");
  assert.equal((envelope.lots as { sourceLineId: string; quantity: string }[])[0]!.sourceLineId, doc.lines[0]!.id);
  assert.equal((envelope.lots as { sourceLineId: string; quantity: string }[])[0]!.quantity, "1");
  assert.match(createHash("sha256").update(canonicalize(envelope)!).digest("hex"), /^[0-9a-f]{64}$/);
  const shown = await db.$transaction((tx) => service.view({ tx, actor, requestId: randomUUID(), emit: () => {} }, doc.id));
  assert.equal(shown.announcement?.messageId, envelope.messageId);
  assert.equal(shown.announcement?.attempts, 0);
  assert.equal(shown.deliveryState, "pending");
  await db.outboxMessage.updateMany({ where: { id: { not: row.id }, status: { in: ["pending", "retry_due"] } },
    data: { nextAttemptAt: new Date("9999-12-31T00:00:00.000Z") } });
  const dispatcher = createOutboxDispatcher({ client: db, workerId: randomUUID(), handlers: buildHandlerMap(), batchSize: 100 });
  assert.equal((await dispatcher.tick()).claimed, 0);
  const held = await db.outboxMessage.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(held.status, "pending");
  assert.equal(held.attemptCount, 0);
  assert.deepEqual(held.payload, row.payload);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: doc.id } }), 2);
});

test("transfer validation and confirm recheck partner, scope and line snapshot", { timeout: 120_000 }, async () => {
  const service = transferService();
  const issue = await transferIssue();
  const input: { linkedIssueId: string; destinationPartnerId: string } = { linkedIssueId: issue.id, destinationPartnerId: partnerId };
  const create = (value = input) => transferCommand("create", value, (ctx) => service.create(ctx, value));
  await assert.rejects(create({ ...input, linkedIssueId: randomUUID() }), { code: "ISSUE_NOT_FOUND", httpStatus: 422 });
  await assert.rejects(create({ ...input, destinationPartnerId: randomUUID() }), { code: "PARTNER_NOT_FOUND", httpStatus: 422 });
  const wrongPurpose = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "other", lines: [line("1")] }), undefined, "goods_issue");
  await assert.rejects(create({ ...input, linkedIssueId: wrongPurpose.id }), { code: "ISSUE_WRONG_PURPOSE", httpStatus: 422 });
  const draft = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "partner_transfer", lines: [line("1")] }), undefined, "goods_issue");
  await assert.rejects(create({ ...input, linkedIssueId: draft.id }), { code: "ISSUE_NOT_CONFIRMED", httpStatus: 409 });
  await owner.partner.update({ where: { id: partnerId }, data: { status: "suspended" } });
  await assert.rejects(create(), { code: "PARTNER_INACTIVE", httpStatus: 422 });
  await owner.partner.update({ where: { id: partnerId }, data: { status: "active" } });
  const localPartner = await owner.partner.create({ data: { id: randomUUID(), issuerInstanceId: "local-instance",
    code: randomUUID(), displayName: "Local", createdBySub: "fixture" } });
  await assert.rejects(create({ ...input, destinationPartnerId: localPartner.id }),
    { code: "PARTNER_SELF_TRANSFER", httpStatus: 422 });
  const emptyPartner = await owner.partner.create({ data: { id: randomUUID(), issuerInstanceId: " ",
    code: randomUUID(), displayName: "Unfederated", createdBySub: "fixture" } });
  await assert.rejects(create({ ...input, destinationPartnerId: emptyPartner.id }),
    { code: "PARTNER_NOT_FEDERATED", httpStatus: 422 });
  const doc = await create();
  await owner.partner.update({ where: { id: partnerId }, data: { status: "suspended" } });
  await assert.rejects(transferCommand("confirm", { id: doc.id }, (ctx) => service.confirm(ctx, doc.id, doc.version), randomUUID()),
    { code: "PARTNER_INACTIVE", httpStatus: 409 });
  await owner.partner.update({ where: { id: partnerId }, data: { status: "active" } });
  await owner.documentLine.update({ where: { id: doc.lines[0]!.id }, data: { quantity: "2" } });
  await assert.rejects(transferCommand("confirm", { id: doc.id }, (ctx) => service.confirm(ctx, doc.id, doc.version), randomUUID()),
    { code: "TRANSFER_LINE_MISMATCH", httpStatus: 409 });
  await owner.documentLine.update({ where: { id: doc.lines[0]!.id }, data: { quantity: "1" } });
  await assert.rejects(db.$transaction((tx) => service.confirm({ tx, actor: { ...actor, unitIds: [] },
    requestId: randomUUID(), emit: () => {} }, doc.id, doc.version)),
  { code: "WAREHOUSE_SCOPE_REQUIRED", httpStatus: 403 });
});

const receiving = createReceivingService(tradingPorts, "remote-instance");
function receivingCommand<T>(action: "create" | "update" | "confirm" | "cancel", payload: unknown,
  work: (ctx: Parameters<typeof receiving.create>[0]) => Promise<T>, key?: string, actingActor = actor) {
  return runCommand({ requestId: randomUUID() }, {
    authenticate: async () => actingActor, resolveTenant: async () => actingActor.organizationId,
    action: `trading:receiving:${action}`, method: action === "update" ? "PATCH" : "POST",
    routeKey: `receiving:${action}`, payload, idempotencyKey: key,
    idempotencyPort: createPrismaIdempotency(db), unitOfWork: tradingUnitOfWork,
    domain: (ctx) => work({ tx: ctx.tx, actor: actingActor, requestId: ctx.requestId, emit: ctx.emit }),
  });
}

test("G07 seeded real announcement: receipt20, approved issue12, transfer, actual10, held reply without ACK", {
  timeout: 120_000,
}, async () => {
  const supply = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_receipt", { lines: [line("20")] }));
  await command("confirm", { id: supply.id }, (ctx) => tradingService.action(ctx,
    "goods_receipt", supply.id, "confirm", supply.version), randomUUID());
  const sent = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue", {
    purpose: "partner_transfer", lines: [line("12")],
  }), undefined, "goods_issue");
  await command("submit", { id: sent.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", sent.id, "submit", sent.version), undefined, "goods_issue");
  await approve(sent.id);
  await command("confirm", { id: sent.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", sent.id, "confirm", sent.version + 2), randomUUID(), "goods_issue");
  const transfer = await transferCommand("create", { issue: sent.id }, (ctx) => transferService().create(ctx,
    { linkedIssueId: sent.id, destinationPartnerId: partnerId }));
  await transferCommand("confirm", { transfer: transfer.id }, (ctx) => transferService().confirm(ctx,
    transfer.id, transfer.version), randomUUID());
  const announced = await db.outboxMessage.findFirstOrThrow({ where: {
    aggregateId: transfer.id, eventType: "transfer.announced.v1" } });
  const envelope = announced.payload as Record<string, unknown>;
  const sourceLot = (envelope.lots as { sourceLineId: string; senderBatch: { batchId: string } }[])[0]!;
  await db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .seedInboundAnnouncement(envelope));
  assert.deepEqual((await db.inboundMessage.findUniqueOrThrow({ where: { messageId: envelope.messageId as string } })).payload, envelope);
  const localBatch = await createCatalogRepos(db).createBatch({ id: randomUUID(), productVariantId: variantId,
    localCode: randomUUID(), originIssuerInstanceId: "local-instance", originLotId: sourceLot.senderBatch.batchId,
    createdBySub: actor.userId });
  const input = { inboundMessageId: envelope.messageId as string, actualLines: [{ sourceLineId: sourceLot.sourceLineId,
    localBatchId: localBatch.id, warehouseId, actualQuantity: "10", unit: "EA" as const }],
    discrepancyReason: "Two units missing" };
  const before = (await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3);
  const draft = await receivingCommand("create", input, (ctx) => receiving.create(ctx, input));
  assert.equal(draft.lines[0]!.sentQuantity, "12.000");
  assert.equal(draft.lines[0]!.actualQuantity, "10.000");
  assert.equal(draft.lines[0]!.sourceLineId, sourceLot.sourceLineId);
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: draft.lines[0]!.id } }), 0);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: draft.id } }), 0);
  const key = randomUUID();
  const confirm = () => receivingCommand("confirm", { id: draft.id, version: draft.version },
    (ctx) => receiving.confirm(ctx, draft.id, draft.version), key);
  const first = await confirm();
  assert.deepEqual(await confirm(), first);
  assert.equal(first.movementIds.length, 1);
  await assert.rejects(receivingCommand("confirm", { id: draft.id }, (ctx) => receiving.confirm(ctx,
    draft.id, draft.version), randomUUID()), { code: "VERSION_CONFLICT" });
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId: localBatch.id } } })).quantity.toFixed(3), "10.000");
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
    warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), before);
  const detail = await db.receivingDetail.findUniqueOrThrow({ where: { documentId: draft.id } });
  assert.equal(detail.sentQuantity.toFixed(3), "12.000");
  assert.equal(detail.actualQuantity?.toFixed(3), "10.000");
  assert.equal(detail.discrepancyReason, "Two units missing");
  const rows = await db.outboxMessage.findMany({ where: { aggregateId: draft.id } });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.eventType)),
    new Set(["trading.receiving.confirmed.v1", "receipt.confirmed.v1"]));
  const reply = rows.find((row) => row.eventType === "receipt.confirmed.v1")!;
  const payload = reply.payload as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  assert.equal(ajv.validate(envelopeSchema, payload), true, ajv.errorsText());
  assert.equal(payload.recipientInstanceId, "local-instance");
  assert.equal(payload.correlationId, envelope.messageId);
  assert.equal(payload.causationId, envelope.messageId);
  assert.equal(payload.discrepancyQuantity, "2");
  assert.equal((payload.actualLines as { actualQuantity: string }[])[0]!.actualQuantity, "10");
  assert.equal((payload.lots as { sourceLineId: string }[])[0]!.sourceLineId, draft.lines[0]!.id);
  assert.equal(reply.nextAttemptAt.getUTCFullYear(), 9999);
  await db.outboxMessage.updateMany({ where: { id: { not: reply.id }, status: { in: ["pending", "retry_due"] } },
    data: { nextAttemptAt: new Date("9999-12-31T00:00:00.000Z") } });
  const dispatcher = createOutboxDispatcher({ client: db, workerId: randomUUID(), handlers: buildHandlerMap() });
  assert.equal((await dispatcher.tick()).claimed, 0);
  const held = await db.outboxMessage.findUniqueOrThrow({ where: { id: reply.id } });
  assert.equal(held.status, "pending"); assert.equal(held.attemptCount, 0);
  assert.deepEqual(held.payload, reply.payload);
  assert.equal(await db.outboxMessage.count({ where: { aggregateId: draft.id, eventType: { contains: "ack" } } }), 0);
  await assert.rejects(receivingCommand("create", input, (ctx) => receiving.create(ctx, input)),
    { code: "RECEIVING_ALREADY_EXISTS", httpStatus: 409 });
  await db.outboxMessage.update({ where: { id: announced.id }, data: { payload: { modified: true } } });
  assert.equal((await db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .resolveVerifiedAnnouncement(input.inboundMessageId))).sentQuantity, "12");
});

test("receiving rejects missing, repeated, unknown and over-received source lines; cancel frees source", async () => {
  const original = (await db.inboundMessage.findFirstOrThrow()).payload as Record<string, unknown>;
  const originalLot = (original.lots as Record<string, unknown>[])[0]!;
  const clone = { ...original, messageId: randomUUID(), eventId: randomUUID(),
    sourceDocument: { type: "partner_transfer", id: randomUUID(), version: 2 },
    lots: [{ ...originalLot, sourceLineId: randomUUID() }, { ...originalLot, sourceLineId: randomUUID() }],
    sentQuantity: "24" };
  const seed = async (payload: Record<string, unknown>) => db.$transaction((tx) => receiving.source({ tx, actor,
    requestId: randomUUID(), emit: () => {} }).seedInboundAnnouncement(payload));
  await seed(clone);
  const localBatch = await db.batch.findFirstOrThrow({ where: { originIssuerInstanceId: "local-instance",
    originLotId: batchId } });
  const actualLines: ActualInput[] = clone.lots.map((lot) => ({ sourceLineId: lot.sourceLineId,
    localBatchId: localBatch.id, warehouseId, actualQuantity: "0", unit: "EA" }));
  const input = { inboundMessageId: clone.messageId, actualLines };
  const create = (value: typeof input) => receivingCommand("create", value, (ctx) => receiving.create(ctx, value));
  await assert.rejects(create({ ...input, actualLines: actualLines.slice(0, 1) }), { code: "SOURCE_LINE_MISSING" });
  await assert.rejects(create({ ...input, actualLines: [actualLines[0]!, actualLines[0]!] }), { code: "SOURCE_LINE_DUPLICATE" });
  await assert.rejects(create({ ...input, actualLines: [{ ...actualLines[0]!, sourceLineId: randomUUID() }, actualLines[1]!] }),
    { code: "SOURCE_LINE_UNKNOWN" });
  await assert.rejects(create({ ...input, actualLines: [{ ...actualLines[0]!, actualQuantity: "13" }, actualLines[1]!] }),
    { code: "OVER_RECEIPT" });
  await assert.rejects(create({ ...input, actualLines: [{ ...actualLines[0]!, localBatchId: randomUUID() }, actualLines[1]!] }),
    { code: "BATCH_NOT_FOUND" });
  await assert.rejects(create({ ...input, actualLines: [{ ...actualLines[0]!, localBatchId: batchId }, actualLines[1]!] }),
    { code: "ORIGIN_MISMATCH" });
  await assert.rejects(create({ ...input, actualLines: [{ ...actualLines[0]!, unit: "KG" }, actualLines[1]!] }),
    { code: "QUANTITY_UNIT_MISMATCH" });
  const races = await Promise.allSettled([create(input), create(input)]);
  assert.equal(races.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(races.filter((outcome) => outcome.status === "rejected" &&
    outcome.reason.code === "RECEIVING_ALREADY_EXISTS").length, 1);
  const draft = (races.find((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<
    Awaited<ReturnType<typeof receiving.create>>>).value;
  await assert.rejects(receivingCommand("confirm", { id: draft.id }, (ctx) => receiving.confirm(ctx,
    draft.id, draft.version), randomUUID()), { code: "DISCREPANCY_REASON_REQUIRED" });
  await assert.rejects(receivingCommand("update", {}, (ctx) => receiving.edit(ctx, draft.id, draft.version,
    { actualLines: [{ sourceLineId: actualLines[0]!.sourceLineId, actualQuantity: "13" }] })),
  { code: "OVER_RECEIPT" });
  await assert.rejects(receivingCommand("confirm", {}, (ctx) => receiving.confirm({ ...ctx, actor: {
    ...actor, unitIds: [],
  } }, draft.id, draft.version), randomUUID()), { code: "WAREHOUSE_SCOPE_REQUIRED" });
  await receivingCommand("cancel", {}, (ctx) => receiving.cancel(ctx, draft.id, draft.version));
  const replacement = await create({ ...input, actualLines: actualLines.map((item) => ({ ...item, actualQuantity: "12" })) });
  assert.notEqual(replacement.id, draft.id);
  await assert.rejects(receivingCommand("confirm", {}, (ctx) => receiving.confirm(ctx,
    draft.id, draft.version + 1), randomUUID()), { code: "WRONG_STATE" });
  const edited = await receivingCommand("update", { version: replacement.version }, (ctx) => receiving.edit(ctx,
    replacement.id, replacement.version, { actualLines: [
      { sourceLineId: actualLines[0]!.sourceLineId, actualQuantity: "10" },
      { sourceLineId: actualLines[1]!.sourceLineId, actualQuantity: "0" },
    ], discrepancyReason: "Part of shipment missing" }));
  assert.equal(edited.actualQuantity, "10.000");
  assert.equal(edited.lines.length, 2);
  const result = await receivingCommand("confirm", { id: replacement.id }, (ctx) => receiving.confirm(ctx,
    replacement.id, edited.version), randomUUID());
  assert.equal(result.movementIds.length, 1);
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: edited.lines[1]!.id } }), 0);
  const reply = await db.outboxMessage.findFirstOrThrow({ where: { aggregateId: replacement.id,
    eventType: "receipt.confirmed.v1" } });
  assert.equal((reply.payload as { actualLines: unknown[] }).actualLines.length, 2);
  assert.equal((reply.payload as { lots: unknown[] }).lots.length, 1);
  await assert.rejects(create(input), { code: "RECEIVING_ALREADY_EXISTS" });
});

test("seeded source rejects wrong recipient, shape and changed hash; batch product must match message", async () => {
  const original = (await db.inboundMessage.findFirstOrThrow()).payload as Record<string, unknown>;
  const originalLot = (original.lots as Record<string, unknown>[])[0]!;
  const clone = { ...original, messageId: randomUUID(), eventId: randomUUID(),
    sourceDocument: { type: "partner_transfer", id: randomUUID(), version: 2 } };
  const seed = (payload: Record<string, unknown>) => db.$transaction((tx) => receiving.source({ tx, actor,
    requestId: randomUUID(), emit: () => {} }).seedInboundAnnouncement(payload));
  await seed({ ...clone, recipientInstanceId: "wrong-instance" });
  await assert.rejects(receivingCommand("create", {}, (ctx) => receiving.create(ctx,
    { inboundMessageId: clone.messageId, actualLines: [] })), { code: "SOURCE_MESSAGE_INVALID" });
  const invalidType = { ...clone, messageId: randomUUID(), eventType: "receipt.confirmed.v1" };
  await seed(invalidType);
  await assert.rejects(db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .resolveVerifiedAnnouncement(invalidType.messageId)), { code: "SOURCE_MESSAGE_INVALID" });
  const wrongTotal = { ...clone, messageId: randomUUID(), sentQuantity: "13" };
  await seed(wrongTotal);
  await assert.rejects(db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .resolveVerifiedAnnouncement(wrongTotal.messageId)), { code: "SOURCE_MESSAGE_INVALID" });
  const badHash = { ...clone, messageId: randomUUID() };
  await seed(badHash);
  await owner.inboundMessage.update({ where: { messageId: badHash.messageId }, data: { payload: { ...badHash,
    sentQuantity: "99" } } });
  await assert.rejects(db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .resolveVerifiedAnnouncement(badHash.messageId)), { code: "SOURCE_MESSAGE_INVALID" });
  const wrongProduct = { ...clone, messageId: randomUUID(), lots: [{ ...originalLot,
    product: { instanceId: "local-instance", productId: randomUUID() } }] };
  await seed(wrongProduct);
  const localBatch = await db.batch.findFirstOrThrow({ where: { originIssuerInstanceId: "local-instance",
    originLotId: batchId } });
  await assert.rejects(receivingCommand("create", {}, (ctx) => receiving.create(ctx, {
    inboundMessageId: wrongProduct.messageId, actualLines: [{ sourceLineId: originalLot.sourceLineId as string,
      localBatchId: localBatch.id, warehouseId, actualQuantity: "10", unit: "EA" }],
  })), { code: "BATCH_PRODUCT_MISMATCH" });
});

test("all-zero receiving emits both events, no movement, full actualLines and empty lots", async () => {
  const original = (await db.inboundMessage.findFirstOrThrow()).payload as Record<string, unknown>;
  const clone = { ...original, messageId: randomUUID(), eventId: randomUUID(),
    sourceDocument: { type: "partner_transfer", id: randomUUID(), version: 2 } };
  await db.$transaction((tx) => receiving.source({ tx, actor, requestId: randomUUID(), emit: () => {} })
    .seedInboundAnnouncement(clone));
  const lot = (original.lots as { sourceLineId: string }[])[0]!;
  const localBatch = await db.batch.findFirstOrThrow({ where: { originIssuerInstanceId: "local-instance",
    originLotId: batchId } });
  const created = await receivingCommand("create", {}, (ctx) => receiving.create(ctx, {
    inboundMessageId: clone.messageId, actualLines: [{ sourceLineId: lot.sourceLineId,
      localBatchId: localBatch.id, warehouseId, actualQuantity: "0", unit: "EA" }],
    discrepancyReason: "No delivery",
  }));
  const result = await receivingCommand("confirm", { id: created.id }, (ctx) => receiving.confirm(ctx,
    created.id, created.version), randomUUID());
  assert.deepEqual(result.movementIds, []);
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: created.lines[0]!.id } }), 0);
  const rows = await db.outboxMessage.findMany({ where: { aggregateId: created.id } });
  assert.equal(rows.length, 2);
  const reply = rows.find((row) => row.eventType === "receipt.confirmed.v1")!;
  const payload = reply.payload as Record<string, unknown>;
  assert.deepEqual(payload.lots, []);
  assert.equal((payload.actualLines as { actualQuantity: string }[])[0]!.actualQuantity, "0");
  assert.equal((rows.find((row) => row.eventType === "trading.receiving.confirmed.v1")!.payload as {
    actualLines: { actualQuantity: string }[] }).actualLines[0]?.actualQuantity, "0");
});

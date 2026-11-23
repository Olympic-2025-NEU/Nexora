// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "../../platform/persistence/prisma";
import { createPrismaIdempotency } from "../../platform/http/idempotency";
import { runCommand } from "../../platform/http/pipeline";
import { tradingService, tradingUnitOfWork, tradingPorts } from "../../composition/trading";
import { createDocumentService } from "../../contexts/trading/application/documents";
import type { Actor } from "../../platform/identity/actor";
import type { TradingKind } from "../../contexts/trading/application/documents";
import { FlowableClient } from "../../platform/workflow/flowable-client";
import { createFlowableStarter } from "../../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../../platform/workflow/flowable-decider";
import { reconcileApproval } from "../../platform/workflow/reconciler";
import { recordDecisionIntent } from "../../platform/workflow/approval-service";
import type { OutboxMessage } from "../../platform/outbox/message";

if (process.env.NEXORA_TEST_DB !== "1") throw new Error("Disposable PostgreSQL required");
const owner = new PrismaClient({ datasources: { db: { url: process.env.OWNER_DATABASE_URL! } } });
const db = getPrismaClient();
const warehouseId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), batchId = randomUUID();
const emptyBatchId = randomUUID();
const stockUomId = "aaaaaaaa-0001-4000-8000-000000000001";
const packUomId = randomUUID();
const orgId = randomUUID();
const actor: Actor = { userId: "receipt-creator", organizationId: "fixture-org", roles: ["staff"], unitIds: [warehouseId] };
const line = (quantity: string, uomId = stockUomId) => ({ warehouseId, productVariantId: variantId, batchId, quantity, uomId });

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
    "goods_issue", issue.id, "confirm", issue.version + 1), undefined, "goods_issue"), { code: "APPROVAL_NOT_YET_APPROVED" });
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
    await reconcileApproval(db, engine, row.id);
    const state = (await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).state;
    if (state === decision) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Decision was not reconciled before timeout");
}

async function issue(quantity: string, count = 1) {
  const doc = await command("create", {}, (ctx) => tradingService.create(ctx, "goods_issue",
    { purpose: "other", lines: Array.from({ length: count }, () => line(quantity)) }), undefined, "goods_issue");
  await command("submit", { id: doc.id }, (ctx) => tradingService.action(ctx,
    "goods_issue", doc.id, "submit", doc.version), undefined, "goods_issue");
  await approve(doc.id);
  return { ...doc, version: doc.version + 1 };
}

test("approved issue 12 posts once; two issues race for remaining stock with real bridge decisions",
  { timeout: 120_000 }, async () => {
    const first = await issue("12");
    const confirmed = await command("confirm", { id: first.id }, (ctx) => tradingService.action(ctx,
      "goods_issue", first.id, "confirm", first.version), randomUUID(), "goods_issue");
    assert.equal(confirmed.status, "confirmed");
    assert.equal(await db.auditLog.count({ where: { targetId: first.id, action: "trading.document.confirm" } }), 1);
    assert.equal(await db.outboxMessage.count({ where: { aggregateId: first.id,
      eventType: "trading.issue.confirmed.v1" } }), 1);
    assert.equal((await db.stockBalance.findUniqueOrThrow({ where: {
      warehouseId_batchId: { warehouseId, batchId } } })).quantity.toFixed(3), "8.000");
    assert.equal(await db.stockMovement.count({ where: { sourceLineId: first.lines[0]!.id } }), 1);
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
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "pending_approval");
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
      "goods_issue", packed.id, "confirm", packed.version + 1), randomUUID(), "goods_issue");
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
      "goods_issue", doc.id, "confirm", doc.version + 1), retryKey, "goods_issue"),
    (err: unknown) => err instanceof Error && "code" in err && err.code === "INSUFFICIENT_STOCK" &&
      "batchId" in err && err.batchId === emptyBatchId);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status, "pending_approval");
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
      "goods_issue", doc.id, "confirm", doc.version + 1), retryKey, "goods_issue");
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
    return { ...doc, version: doc.version + 1 };
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
    "goods_issue", doc.id, "confirm", doc.version + 1), randomUUID(), "goods_issue"),
  { code: "APPROVAL_REJECTED", httpStatus: 409 });
  assert.equal(await db.stockMovement.count({ where: { sourceLineId: doc.lines[0]!.id } }), 0);
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

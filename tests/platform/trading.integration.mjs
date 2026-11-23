// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import trading from "../../contexts/trading/infrastructure/prisma-repos.ts";
const { createTradingRepos, TradingUniqueViolation } = trading;

if (process.env.NEXORA_TEST_DB !== "1") throw new Error("Disposable database required");
const connect = (url) => new PrismaClient({ datasources: { db: { url } } });
const owner = connect(process.env.DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
after(async () => Promise.all([owner.$disconnect(), app.$disconnect()]));

const ids = { partner: randomUUID(), warehouse: randomUUID(), product: randomUUID(),
  altProduct: randomUUID(), variant: randomUUID(), batch: randomUUID(), altBatch: randomUUID(),
  uom: "aaaaaaaa-0001-4000-8000-000000000001",
  invalidUom: "aaaaaaaa-0001-4000-8000-000000000002" };

function header(type = "goods_receipt", overrides = {}) {
  return { id: randomUUID(), documentType: type, documentNumber: randomUUID(),
    createdBySub: "test-actor", correlationId: randomUUID(),
    ...(type === "goods_issue" ? { issuePurpose: "partner_transfer" } : {}), ...overrides };
}
function line(documentId, overrides = {}) {
  return { id: randomUUID(), documentId, lineNo: 1, warehouseId: ids.warehouse,
    batchId: ids.batch, productVariantId: ids.variant, productId: ids.product,
    uomId: ids.uom, quantity: "12", ...overrides };
}
async function confirm(tx, id) {
  await tx.$executeRaw`UPDATE trading.document SET status='confirmed', confirmed_by_sub='test-actor', confirmed_at=now() WHERE id=${id}::uuid`;
}
async function insertHeader(tx, doc) {
  await tx.$executeRaw`INSERT INTO trading.document
    (id, document_type, document_number, issue_purpose, created_by_sub, correlation_id, correction_of_document_id, correction_reason)
    VALUES (${doc.id}::uuid, ${doc.documentType}, ${doc.documentNumber}, ${doc.issuePurpose ?? null},
      ${doc.createdBySub}, ${doc.correlationId}, ${doc.correctionOfDocumentId ?? null}::uuid, ${doc.correctionReason ?? null})`;
}
async function insertLine(tx, row) {
  await tx.$executeRaw`INSERT INTO trading.document_line
    (id, document_id, line_no, warehouse_id, batch_id, product_variant_id, product_id, uom_id,
     quantity, actual_quantity, counted_quantity, source_issue_line_id, source_line_ref)
    VALUES (${row.id}::uuid, ${row.documentId}::uuid, ${row.lineNo}, ${row.warehouseId}::uuid,
      ${row.batchId}::uuid, ${row.productVariantId}::uuid, ${row.productId}::uuid, ${row.uomId}::uuid,
      ${row.quantity ?? null}::numeric, ${row.actualQuantity ?? null}::numeric,
      ${row.countedQuantity ?? null}::numeric, ${row.sourceIssueLineId ?? null}::uuid,
      ${row.sourceLineRef ?? null}::uuid)`;
}
async function attack(code, operation) {
  await assert.rejects(app.$transaction(operation), (error) => {
    assert.match(String(error), new RegExp(code));
    return true;
  });
}

test("seed catalog and partner as migrator", async () => {
  await owner.$executeRaw`INSERT INTO system.partner(id, issuer_instance_id, code, display_name, status, created_by_sub)
    VALUES (${ids.partner}::uuid, ${randomUUID()}, ${randomUUID()}, 'Partner', 'active', 'test')`;
  await owner.$executeRaw`INSERT INTO inventory.warehouse(id, code, name, status, created_by_sub)
    VALUES (${ids.warehouse}::uuid, ${randomUUID()}, 'Warehouse', 'active', 'test')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id, name, category_id, created_by_sub)
    VALUES (${ids.product}::uuid, 'Product', 'bbbbbbbb-0001-4000-8000-000000000001', 'test')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id, name, category_id, created_by_sub)
    VALUES (${ids.altProduct}::uuid, 'Other product', 'bbbbbbbb-0001-4000-8000-000000000001', 'test')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id, product_id, sku, created_by_sub)
    VALUES (${ids.variant}::uuid, ${ids.product}::uuid, ${randomUUID()}, 'test')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant_uom(id, product_variant_id, uom_id, is_stock_keeping, factor_to_stock_uom)
    VALUES (${randomUUID()}::uuid, ${ids.variant}::uuid, ${ids.uom}::uuid, true, 1)`;
  await owner.$executeRaw`INSERT INTO catalog.batch(id, product_id, product_variant_id, local_code, origin_issuer_instance_id, origin_lot_id, created_by_sub)
    VALUES (${ids.batch}::uuid, ${ids.product}::uuid, ${ids.variant}::uuid, ${randomUUID()}, 'source', ${randomUUID()}, 'test')`;
  await owner.$executeRaw`INSERT INTO catalog.batch(id, product_id, product_variant_id, local_code, origin_issuer_instance_id, origin_lot_id, created_by_sub)
    VALUES (${ids.altBatch}::uuid, ${ids.product}::uuid, ${ids.variant}::uuid, ${randomUUID()}, 'source', ${randomUUID()}, 'test')`;
  const constraints = await owner.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid='catalog.batch'::regclass AND conname='batch_id_variant_key'`;
  assert.equal(constraints.length, 1);
});

test("raw app SQL rejects invalid confirmed documents, preserves drafts and confirmed rows", async () => {
  const empty = header();
  await attack("no_lines", async (tx) => { await insertHeader(tx, empty); await confirm(tx, empty.id); });
  for (const [type, override] of [
    ["goods_receipt", { quantity: null }], ["stocktake", { quantity: null, countedQuantity: null }],
    ["receiving_confirmation", { actualQuantity: null, sourceLineRef: randomUUID() }],
  ]) {
    const doc = header(type);
    await attack("missing_line_field", async (tx) => {
      await insertHeader(tx, doc);
      await insertLine(tx, line(doc.id, override));
      await confirm(tx, doc.id);
    });
  }
  const wrongUom = header();
  await attack("uom_not_allowed", async (tx) => {
    await insertHeader(tx, wrongUom);
    await insertLine(tx, line(wrongUom.id, { uomId: ids.invalidUom }));
    await confirm(tx, wrongUom.id);
  });
  const draft = header();
  await insertHeader(app, draft);
  await insertLine(app, line(draft.id, { quantity: null }));
  assert.equal((await app.document.findUniqueOrThrow({ where: { id: draft.id } })).status, "draft");
  const good = header();
  const goodLine = line(good.id);
  await app.$transaction(async (tx) => {
    await insertHeader(tx, good);
    await confirm(tx, good.id);
    await insertLine(tx, goodLine);
  });
  await attack("immutable_document", (tx) => tx.$executeRaw`UPDATE trading.document SET note='changed' WHERE id=${good.id}::uuid`);
  await attack("immutable_line", (tx) => tx.$executeRaw`INSERT INTO trading.document_line
    (id, document_id, line_no, warehouse_id, batch_id, product_variant_id, product_id, uom_id, quantity)
    VALUES (${randomUUID()}::uuid, ${good.id}::uuid, 2, ${ids.warehouse}::uuid, ${ids.batch}::uuid,
    ${ids.variant}::uuid, ${ids.product}::uuid, ${ids.uom}::uuid, 1)`);
  await attack("immutable_line", (tx) => tx.$executeRaw`DELETE FROM trading.document_line WHERE id=${goodLine.id}::uuid`);
  await attack("immutable_line", (tx) => tx.$executeRaw`UPDATE trading.document_line SET quantity=11 WHERE id=${goodLine.id}::uuid`);
  const wrongProduct = header();
  await attack("product_mismatch", async (tx) => {
    await insertHeader(tx, wrongProduct);
    await insertLine(tx, line(wrongProduct.id, { productId: ids.altProduct }));
    await confirm(tx, wrongProduct.id);
  });
  await assert.rejects(app.$executeRaw`INSERT INTO platform.approval_request
    (id, document_id, submitted_document_version, creator_sub, warehouse_ids, line_snapshot_sha256, state)
    VALUES (${randomUUID()}::uuid, ${randomUUID()}::uuid, 1, 'test', '[]'::jsonb, ${"a".repeat(64)}, 'requested')`, /23503/);
  await assert.rejects(app.$executeRaw`INSERT INTO inventory.stock_movement
    (id, warehouse_id, batch_id, product_id, product_variant_id, source_line_id,
     kind, delta, balance_after, actor_sub, correlation_id)
    VALUES (${randomUUID()}::uuid, ${ids.warehouse}::uuid, ${ids.batch}::uuid,
      ${ids.product}::uuid, ${ids.variant}::uuid, ${randomUUID()}::uuid,
      'receipt', 1, 1, 'test', 'test')`, /23503/);
  const duplicate = header("goods_receipt", { documentNumber: good.documentNumber });
  await assert.rejects(insertHeader(app, duplicate), /23505/);
});

test("transfer, sale and receiving raw SQL validate links and totals", async () => {
  const issue = header("goods_issue");
  const issueLine = line(issue.id);
  await app.$transaction(async (tx) => {
    await insertHeader(tx, issue);
    await insertLine(tx, issueLine);
    await confirm(tx, issue.id);
  });
  const transfer = header("partner_transfer");
  await attack("line_mismatch", async (tx) => {
    await insertHeader(tx, transfer);
    await tx.$executeRaw`INSERT INTO trading.transfer_detail(document_id, linked_issue_id, destination_partner_id)
      VALUES (${transfer.id}::uuid, ${issue.id}::uuid, ${ids.partner}::uuid)`;
    await insertLine(tx, line(transfer.id, { sourceIssueLineId: issueLine.id, quantity: "11" }));
    await confirm(tx, transfer.id);
  });
  const wrongLot = header("partner_transfer");
  await attack("line_mismatch", async (tx) => {
    await insertHeader(tx, wrongLot);
    await tx.$executeRaw`INSERT INTO trading.transfer_detail(document_id, linked_issue_id, destination_partner_id)
      VALUES (${wrongLot.id}::uuid, ${issue.id}::uuid, ${ids.partner}::uuid)`;
    await insertLine(tx, line(wrongLot.id, { sourceIssueLineId: issueLine.id, batchId: ids.altBatch }));
    await confirm(tx, wrongLot.id);
  });
  const sale = header("sale_record");
  await attack("issue_purpose", async (tx) => {
    await insertHeader(tx, sale);
    await tx.$executeRaw`INSERT INTO trading.sale_detail(document_id, linked_issue_id, sold_at)
      VALUES (${sale.id}::uuid, ${issue.id}::uuid, now())`;
  });
  const wrongDetail = header();
  await attack("detail_type", async (tx) => {
    await insertHeader(tx, wrongDetail);
    await tx.$executeRaw`INSERT INTO trading.transfer_detail(document_id, linked_issue_id, destination_partner_id)
      VALUES (${wrongDetail.id}::uuid, ${issue.id}::uuid, ${ids.partner}::uuid)`;
  });
  const valid = header("partner_transfer");
  await app.$transaction(async (tx) => {
    await insertHeader(tx, valid);
    await tx.$executeRaw`INSERT INTO trading.transfer_detail(document_id, linked_issue_id, destination_partner_id)
      VALUES (${valid.id}::uuid, ${issue.id}::uuid, ${ids.partner}::uuid)`;
    await insertLine(tx, line(valid.id, { sourceIssueLineId: issueLine.id }));
    await confirm(tx, valid.id);
  });
  await app.$executeRaw`UPDATE trading.transfer_detail SET delivery_state='technical_ack' WHERE document_id=${valid.id}::uuid`;
  assert.equal((await app.transferDetail.findUniqueOrThrow({ where: { documentId: valid.id } })).deliveryState, "technical_ack");
  await attack("immutable_detail", (tx) => tx.$executeRaw`UPDATE trading.transfer_detail
    SET destination_partner_id=${randomUUID()}::uuid WHERE document_id=${valid.id}::uuid`);
  await attack("immutable_detail", (tx) => tx.$executeRaw`DELETE FROM trading.transfer_detail WHERE document_id=${valid.id}::uuid`);
  for (const [actual, sent, reason, code] of [
    ["13", "12", "over", "actual_out_of_range"],
    ["10", "12", null, "discrepancy_reason_required"],
    ["10", "10", null, "receiving_total_mismatch"],
  ]) {
    const receiving = header("receiving_confirmation");
    await attack(code, async (tx) => {
      await insertHeader(tx, receiving);
      await tx.$executeRaw`INSERT INTO trading.receiving_detail
        (document_id, source_issuer_instance_id, source_transfer_id, sent_quantity, actual_quantity, discrepancy_reason)
        VALUES (${receiving.id}::uuid, 'remote', ${randomUUID()}, ${sent}::numeric, ${actual}::numeric, ${reason})`;
      await insertLine(tx, line(receiving.id, { actualQuantity: actual, sourceLineRef: randomUUID() }));
      await confirm(tx, receiving.id);
    });
  }
  const noReference = header("receiving_confirmation");
  await attack("missing_line_field", async (tx) => {
    await insertHeader(tx, noReference);
    await tx.$executeRaw`INSERT INTO trading.receiving_detail
      (document_id, source_issuer_instance_id, source_transfer_id, sent_quantity, actual_quantity)
      VALUES (${noReference.id}::uuid, 'remote', ${randomUUID()}, 12, 12)`;
    await insertLine(tx, line(noReference.id, { actualQuantity: "12" }));
    await confirm(tx, noReference.id);
  });
  const partial = header("receiving_confirmation");
  await app.$transaction(async (tx) => {
    await insertHeader(tx, partial);
    await tx.$executeRaw`INSERT INTO trading.receiving_detail
      (document_id, source_issuer_instance_id, source_transfer_id, sent_quantity, actual_quantity, discrepancy_reason)
      VALUES (${partial.id}::uuid, 'remote', ${randomUUID()}, 12, 0, 'Nothing arrived')`;
    await insertLine(tx, line(partial.id, { actualQuantity: "0", sourceLineRef: randomUUID() }));
    await confirm(tx, partial.id);
  });
});

test("partial correction uniqueness and caller-owned repository transaction", async () => {
  const source = header();
  await app.$transaction(async (tx) => {
    await insertHeader(tx, source);
    await insertLine(tx, line(source.id));
    await confirm(tx, source.id);
  });
  const correction = () => header("goods_receipt", { correctionOfDocumentId: source.id, correctionReason: "Corrected" });
  const first = correction();
  const second = correction();
  const outcomes = await Promise.allSettled([
    app.$transaction(async (tx) => { await insertHeader(tx, first); }),
    app.$transaction(async (tx) => { await insertHeader(tx, second); }),
  ]);
  assert.deepEqual(outcomes.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const winner = outcomes[0].status === "fulfilled" ? first : second;
  await app.$executeRaw`UPDATE trading.document SET status='cancelled' WHERE id=${winner.id}::uuid`;
  await insertHeader(app, correction());

  const rollback = header();
  await assert.rejects(app.$transaction(async (tx) => {
    const repos = createTradingRepos(tx);
    await repos.createDocument(rollback);
    const changed = await repos.updateDraft(rollback.id, 1, { note: "edited" });
    assert.equal(changed.version, 2);
    const replaced = await repos.replaceLines(rollback.id, 2, [{ ...line(rollback.id), documentId: undefined }]);
    assert.equal(replaced.version, 3);
    assert.equal((await repos.getAggregate(rollback.id)).lines.length, 1);
    assert.equal(await repos.updateDraft(rollback.id, 2, { note: "stale" }), null);
    throw new Error("rollback witness");
  }), /rollback witness/);
  assert.equal(await app.document.findUnique({ where: { id: rollback.id } }), null);
  const duplicate = header("goods_receipt", { documentNumber: source.documentNumber });
  await assert.rejects(app.$transaction((tx) => createTradingRepos(tx).createDocument(duplicate)),
    (error) => error instanceof TradingUniqueViolation && error.constraint === "uq_trading_document_number");
});

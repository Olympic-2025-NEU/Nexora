// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createTraceRepository, makeLocalTraceEvent, makeTraceLink } from "../../contexts/traceability";

if (process.env.NEXORA_TEST_TRACE !== "1" || !process.env.OWNER_DATABASE_URL ||
    !process.env.APP_DATABASE_URL) throw new Error("Disposable trace database required");
const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });
const owner = connect(process.env.OWNER_DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
after(async () => { await Promise.all([owner.$disconnect(), app.$disconnect()]); });
const ids = { product: randomUUID(), variant: randomUUID(), batch: randomUUID(),
  otherBatch: randomUUID(), warehouse: randomUUID(), document: randomUUID() };
const uom = "aaaaaaaa-0001-4000-8000-000000000001";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const localInput = (overrides: Record<string, unknown> = {}) => ({
  issuerInstanceId: "instance-a", externalEventId: randomUUID(),
  eventType: "trading.receipt.confirmed.v1", batchId: ids.batch, documentId: ids.document,
  originIssuerInstanceId: "origin-a", originLotId: "LOT-001", occurredAt: new Date(),
  payloadVersion: "1", summary: { schemaVersion: 1, sourceDocumentId: ids.document },
  ...overrides,
});

test("P08 schema, role grants, migration and safe initial states", async () => {
  const tables = await owner.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema='traceability' ORDER BY table_name`;
  assert.deepEqual(tables.map((row) => row.table_name),
    ["passport_policy", "passport_projection", "qr_token", "trace_event", "trace_link"]);
  const rights = await owner.$queryRaw<Array<Record<string, boolean>>>`
    SELECT has_table_privilege('app_runtime','traceability.trace_event','INSERT') AS event_insert,
      has_table_privilege('app_runtime','traceability.trace_event','UPDATE') AS event_update,
      has_table_privilege('app_runtime','traceability.trace_event','DELETE') AS event_delete,
      has_table_privilege('app_runtime','traceability.passport_policy','INSERT') AS policy_insert,
      has_table_privilege('app_runtime','traceability.passport_projection','UPDATE') AS passport_update,
      has_table_privilege('core_data','traceability.trace_event','SELECT') AS core_event_read`;
  assert.deepEqual(rights[0], { event_insert: true, event_update: false,
    event_delete: false, policy_insert: true, passport_update: true, core_event_read: false });
  const migration = await owner.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM public._prisma_migrations
    WHERE migration_name='20261123060000_traceability_baseline' AND finished_at IS NOT NULL`;
  assert.equal(migration.length, 1);
  const policyMigration = await owner.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM public._prisma_migrations
    WHERE migration_name='20261124010000_passport_policy' AND finished_at IS NOT NULL`;
  assert.equal(policyMigration.length, 1);
  const indexes = await owner.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname='traceability'`;
  for (const name of ["uq_trace_event_external", "uq_trace_event_local_action",
    "uq_trace_link_event", "uq_trace_link_gap", "uq_passport_batch", "uq_qr_token_hash",
    "uq_passport_policy_version", "uq_passport_policy_draft", "uq_passport_policy_approved"]) {
    assert.ok(indexes.some((index) => index.indexname === name), name);
  }
});

test("P08 provenance requires a confirmed source and keeps issuer-qualified events immutable", async () => {
  await owner.$executeRaw`INSERT INTO inventory.warehouse(id,code,name,status,created_by_sub)
    VALUES (${ids.warehouse}::uuid,${randomUUID()},'Trace warehouse','active','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product(id,name,category_id,created_by_sub)
    VALUES (${ids.product}::uuid,'Trace product','bbbbbbbb-0001-4000-8000-000000000001','fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant(id,product_id,sku,created_by_sub)
    VALUES (${ids.variant}::uuid,${ids.product}::uuid,${randomUUID()},'fixture')`;
  await owner.$executeRaw`INSERT INTO catalog.product_variant_uom(id,product_variant_id,uom_id,is_stock_keeping,factor_to_stock_uom)
    VALUES (${randomUUID()}::uuid,${ids.variant}::uuid,${uom}::uuid,true,1)`;
  for (const [id, code] of [[ids.batch, "LOT-A"], [ids.otherBatch, "LOT-B"]]) {
    await owner.$executeRaw`INSERT INTO catalog.batch(id,product_id,product_variant_id,local_code,
      origin_issuer_instance_id,origin_lot_id,quality_status,created_by_sub)
      VALUES (${id}::uuid,${ids.product}::uuid,${ids.variant}::uuid,${code},'origin-a',
        ${code === "LOT-A" ? "LOT-001" : "LOT-002"},'available','fixture')`;
  }
  await app.document.create({ data: { id: ids.document, documentType: "goods_receipt",
    documentNumber: randomUUID(), status: "draft", createdBySub: "fixture",
    correlationId: randomUUID() } });
  await app.documentLine.create({ data: { id: randomUUID(), documentId: ids.document,
    lineNo: 1, warehouseId: ids.warehouse, batchId: ids.batch,
    productVariantId: ids.variant, productId: ids.product, uomId: uom, quantity: "12" } });
  await assert.rejects(app.$transaction(async (tx) =>
    createTraceRepository(tx).appendLocalEvent(localInput())), /source_not_confirmed/);
  assert.equal(await app.traceEvent.count(), 0);
  await app.document.update({ where: { id: ids.document }, data: {
    status: "confirmed", confirmedBySub: "fixture", confirmedAt: new Date(),
  } });
  const rolledBackId = randomUUID();
  await assert.rejects(app.$transaction(async (tx) => {
    await createTraceRepository(tx).appendLocalEvent(localInput({ externalEventId: rolledBackId }));
    throw new Error("force_source_rollback");
  }), /force_source_rollback/);
  assert.equal(await app.traceEvent.count(), 0);
  const externalEventId = randomUUID();
  const first = await app.$transaction(async (tx) =>
    createTraceRepository(tx).appendLocalEvent(localInput({ externalEventId })));
  assert.match(first.checksumHex, /^[0-9a-f]{64}$/);
  assert.deepEqual((await app.traceEvent.findUniqueOrThrow({ where: { id: first.id } })).evidenceRefs, []);
  assert.equal((await app.$transaction(async (tx) =>
    createTraceRepository(tx).findLocalSource(ids.document, ids.batch,
      "trading.receipt.confirmed.v1")))?.id, first.id);
  await assert.rejects(app.$transaction(async (tx) =>
    createTraceRepository(tx).appendLocalEvent(localInput({ externalEventId }))),
  (error: unknown) => (error as { code?: string }).code === "P2002");
  await assert.rejects(app.$transaction(async (tx) =>
    createTraceRepository(tx).appendLocalEvent(localInput())),
  (error: unknown) => (error as { code?: string }).code === "P2002");
  for (const invalid of [
    { batchId: ids.otherBatch }, { originLotId: "WRONG" },
    { eventType: "trading.issue.confirmed.v1" },
  ]) await assert.rejects(app.$transaction(async (tx) =>
    createTraceRepository(tx).appendLocalEvent(localInput(invalid))), /source_not_confirmed/);
  await assert.rejects(owner.traceEvent.update({ where: { id: first.id },
    data: { summary: { changed: true } } }), /immutable/);
  await assert.rejects(owner.traceEvent.delete({ where: { id: first.id } }), /immutable/);
  assert.equal(await app.traceEvent.count(), 1);

  const remote = await owner.traceEvent.create({ data: { id: randomUUID(),
    issuerInstanceId: "instance-b", externalEventId, eventType: "transfer.announced.v1",
    originIssuerInstanceId: "origin-b", originLotId: "LOT-001",
    occurredAt: new Date(), verificationState: "partner_asserted",
    payloadVersion: "1", summary: {}, checksumHex: sha("{}") } });
  assert.notEqual(remote.issuerInstanceId, (await app.traceEvent.findUniqueOrThrow({
    where: { id: first.id } })).issuerInstanceId);
  const link = await app.$transaction(async (tx) => createTraceRepository(tx).appendLink({
    fromEventId: first.id, toEventId: remote.id, relation: "derived_from",
    verificationState: "partner_asserted",
  }));
  assert.ok(link.id);
  await assert.rejects(app.$transaction(async (tx) => createTraceRepository(tx).appendLink({
    fromEventId: first.id, toEventId: remote.id, relation: "derived_from",
    verificationState: "partner_asserted",
  })), (error: unknown) => (error as { code?: string }).code === "P2002");
  const gap = { issuerInstanceId: "instance-c", eventId: "missing-event" };
  await app.$transaction(async (tx) => createTraceRepository(tx).appendLink({
    fromEventId: first.id, missingRef: gap, relation: "received_from", verificationState: "missing",
  }));
  await assert.rejects(app.$transaction(async (tx) => createTraceRepository(tx).appendLink({
    fromEventId: first.id, missingRef: gap, relation: "received_from", verificationState: "missing",
  })), (error: unknown) => (error as { code?: string }).code === "P2002");
  await assert.rejects(owner.traceLink.create({ data: { id: randomUUID(),
    fromEventId: first.id, missingRef: { ...gap, invented: true },
    relation: "received_from", verificationState: "missing" } }));
  assert.throws(() => makeTraceLink({ fromEventId: first.id, toEventId: first.id,
    relation: "corrects", verificationState: "local_verified" }));
  assert.throws(() => makeLocalTraceEvent(localInput({ eventType: "trading.draft.v1" })));

  const passport = await app.passportProjection.create({ data: { id: randomUUID(),
    batchId: ids.batch, publicPayload: {}, sourceEventIds: [first.id], policyVersion: "v1",
    builtAt: new Date(), checksumHex: sha("{}") } });
  assert.equal(passport.state, "stale");
  const qr = await app.qrToken.create({ data: { id: randomUUID(), batchId: ids.batch,
    tokenHash: sha(randomUUID()), createdBySub: "fixture" } });
  assert.equal(qr.state, "revoked");
  await assert.rejects(app.passportProjection.create({ data: { id: randomUUID(),
    batchId: ids.batch, publicPayload: {}, sourceEventIds: [], policyVersion: "v1",
    builtAt: new Date(), checksumHex: sha("{}") } }),
  (error: unknown) => (error as { code?: string }).code === "P2002");
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { attachmentRepository, coreRecordRepository } from "../../services/core-data/repositories.mjs";

if (process.env.NEXORA_TEST_DB !== "1") {
  throw new Error("Platform integration tests require NEXORA_TEST_DB=1 and an isolated database");
}
for (const key of ["DATABASE_URL", "CORE_DATABASE_URL", "APP_DATABASE_URL"]) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

const connect = (url) => new PrismaClient({ datasources: { db: { url } } });
const migrator = connect(process.env.DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
const app = connect(process.env.APP_DATABASE_URL);
after(async () => Promise.all([migrator.$disconnect(), core.$disconnect(), app.$disconnect()]));

test("versioned schema contains platform tables, expected constraints and migrations", async () => {
  const tables = await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'platform' ORDER BY table_name`;
  assert.deepEqual(tables.map((row) => row.table_name), ["approval_request", "attachment", "audit_log", "core_record", "idempotency_record", "inbound_message", "outbox_message"]);

  const columns = await migrator.$queryRaw`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'platform' ORDER BY table_name, ordinal_position`;
  const byTable = (name) => columns.filter((row) => row.table_name === name).map((row) => row.column_name);
  assert.deepEqual(byTable("audit_log"), [
    "id", "created_at", "actor_sub", "client_id", "action", "target_type", "target_id",
    "outcome", "request_id", "correlation_id", "before_summary", "after_summary",
  ]);
  assert.deepEqual(byTable("attachment"), [
    "id", "created_at", "updated_at", "version", "owner_type", "owner_id", "bucket",
    "object_key", "sha256_hex", "mime_type", "size_bytes", "scan_state", "visibility",
    "created_by_sub", "scanned_at", "scan_engine_version", "upload_key_hash", "upload_payload_hash",
    "scan_attempts", "scan_error_code", "next_scan_at", "scan_lease_id", "scan_lease_until",
    "quarantine_purged_at",
  ]);
  assert.deepEqual(byTable("core_record"), [
    "id", "created_at", "updated_at", "version", "kind", "source_type", "source_id",
    "payload", "visibility", "policy_version", "checksum_hex", "built_at",
  ]);
  assert.deepEqual(byTable("idempotency_record"), [
    "id", "created_at", "actor_or_client", "method", "route_key", "idempotency_key",
    "payload_sha256", "state", "response_status", "response_body", "resource_id", "expires_at",
  ]);
  assert.deepEqual(byTable("outbox_message"), [
    "id", "created_at", "aggregate_type", "aggregate_id", "aggregate_version", "event_type",
    "schema_version", "payload", "destination", "correlation_id", "status", "attempt_count",
    "next_attempt_at", "lease_owner", "lease_until", "last_error_code", "delivered_at",
  ]);
  assert.deepEqual(byTable("inbound_message"), ["message_id", "event_type", "issuer_instance_id",
    "recipient_instance_id", "payload", "payload_hash", "received_at"]);

  const constraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('platform.audit_log'::regclass,
                       'platform.attachment'::regclass,
                        'platform.core_record'::regclass,
                         'platform.idempotency_record'::regclass,
                         'platform.outbox_message'::regclass)`;
  const names = new Set(constraints.map((row) => row.conname));
  for (const name of [
    "audit_log_actor_check", "audit_log_outcome_check", "audit_log_correlation_id_check",
    "attachment_sha256_check", "attachment_size_check", "attachment_scan_state_check",
    "attachment_upload_hash_pair_check", "attachment_upload_key_hash_check", "attachment_upload_payload_hash_check",
    "attachment_scan_attempts_check", "attachment_scan_lease_pair_check", "attachment_scan_error_code_check",
    "attachment_quarantine_purged_state_check",
    "core_record_kind_check", "core_record_checksum_check",
    "idempotency_record_state_check", "idempotency_record_payload_sha256_check",
    "outbox_message_status_check", "outbox_message_attempt_count_check",
  ]) assert.ok(names.has(name), `missing constraint ${name}`);

  const migrations = await migrator.$queryRaw`
    SELECT migration_name FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.ok(migrations.some((row) => row.migration_name === "20261118020000_platform_core_audit_grant"));
  assert.ok(migrations.some((row) => row.migration_name === "20261119000000_file_upload_idempotency"));
  assert.ok(migrations.some((row) => row.migration_name === "20261119010000_file_scan_retry"));
  assert.ok(migrations.some((row) => row.migration_name === "20261120000000_platform_delivery_idempotency"));
  assert.ok(migrations.some((row) => row.migration_name === "20261120010000_platform_delivery_outbox"));
  assert.ok(migrations.some((row) => row.migration_name === "20261124040000_federation_delivery_attempt"));
  const delivery = await migrator.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'federation' AND table_name = 'delivery_attempt'
    ORDER BY ordinal_position`;
  assert.deepEqual(delivery.map((row) => row.column_name), ["id", "created_at", "outbox_id",
    "attempt_no", "endpoint_host", "http_status", "result", "error_code", "duration_ms",
    "ack_message_id", "ack_id", "ack_status"]);
  const deliveryConstraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conrelid = 'federation.delivery_attempt'::regclass`;
  for (const name of ["ck_delivery_attempt_no", "ck_delivery_result", "ck_delivery_ack_fields",
    "uq_delivery_outbox_attempt"]) assert.ok(deliveryConstraints.some((row) => row.conname === name));
  const deliveryGrants = await migrator.$queryRaw`
    SELECT has_table_privilege('app_runtime','federation.delivery_attempt','INSERT') AS app_insert,
      has_table_privilege('core_data','federation.delivery_attempt','SELECT') AS core_read`;
  assert.deepEqual(deliveryGrants[0], { app_insert: true, core_read: false });
  const indexes = await migrator.$queryRaw`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'platform' AND tablename = 'outbox_message'`;
  assert.match(indexes.find((row) => row.indexname === "outbox_message_due_idx").indexdef,
    /\(next_attempt_at, created_at\) WHERE \(status = ANY/);
  assert.ok(indexes.some((row) => row.indexdef.includes("UNIQUE") &&
    row.indexdef.includes("(aggregate_type, aggregate_id, aggregate_version, event_type, destination)")));
  assert.ok(indexes.some((row) => row.indexname === "outbox_message_correlation_id_idx"));
  const stock = await migrator.$queryRaw`
    SELECT to_regclass('inventory.stock_balance')::text AS relation`;
  assert.equal(stock[0].relation, "inventory.stock_balance", "P06 creates inventory.stock_balance");
  const catalog = await migrator.$queryRaw`
    SELECT to_regclass('catalog.product')::text AS relation`;
  assert.equal(catalog[0].relation, "catalog.product", "P06 creates catalog.product");
  const trading = await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'trading' ORDER BY table_name`;
  assert.deepEqual(trading.map((row) => row.table_name),
    ["document", "document_line", "issue_source_allocation", "receiving_detail", "sale_detail", "transfer_detail"]);
  assert.ok(migrations.some((row) => row.migration_name === "20261124040000_issue_source_allocation"));
  const allocation = await migrator.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='trading' AND table_name='issue_source_allocation'
    ORDER BY ordinal_position`;
  assert.deepEqual(allocation.map((row) => row.column_name),
    ["id", "issue_line_id", "source_line_id", "quantity"]);
  assert.ok(migrations.some((row) => row.migration_name === "20261123010000_trading_documents"));
  assert.ok(migrations.some((row) => row.migration_name === "20261123020000_transfer_active_link"));
  const transferConstraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conrelid='trading.transfer_detail'::regclass`;
  assert.ok(!transferConstraints.some((row) => row.conname === "uq_trading_transfer_issue"));
  assert.ok(transferConstraints.some((row) => row.conname === "trg_trading_active_transfer_detail"));
  const receivingConstraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conrelid='trading.receiving_detail'::regclass`;
  assert.ok(!receivingConstraints.some((row) => row.conname === "uq_trading_receiving_source"));
  assert.ok(receivingConstraints.some((row) => row.conname === "trg_trading_active_receiving_detail"));
  assert.ok(migrations.some((row) => row.migration_name === "20261123030000_receiving_active_source"));
  const saleConstraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conrelid='trading.sale_detail'::regclass`;
  assert.ok(!saleConstraints.some((row) => row.conname === "uq_trading_sale_issue"));
  assert.ok(saleConstraints.some((row) => row.conname === "trg_trading_active_sale_detail"));
  const saleDocumentTrigger = await migrator.$queryRaw`
    SELECT tgname FROM pg_trigger WHERE tgrelid='trading.document'::regclass
      AND tgname='trg_trading_active_sale_document'`;
  assert.equal(saleDocumentTrigger.length, 1);
  assert.ok(migrations.some((row) => row.migration_name === "20261123050000_sale_active_issue"));
  const tradingConstraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conname IN
      ('batch_id_variant_key','fk_trading_movement_line','fk_trading_approval_document',
       'fk_trading_line_batch_variant','uq_trading_document_number')`;
  assert.deepEqual(tradingConstraints.map((row) => row.conname).sort(),
    ["batch_id_variant_key", "fk_trading_approval_document", "fk_trading_line_batch_variant",
      "fk_trading_movement_line", "uq_trading_document_number"].sort());
  const tradingIndexes = await migrator.$queryRaw`
    SELECT indexname FROM pg_indexes WHERE schemaname='trading' AND indexname IN
      ('idx_trading_document_status_time','idx_trading_document_type_time',
       'idx_trading_line_batch_document','idx_trading_transfer_partner','uq_trading_one_active_correction')`;
  assert.equal(tradingIndexes.length, 5);
});

test("runtime roles are separate, least privilege and fail closed", async () => {
  const roles = await migrator.$queryRaw`
    SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
    FROM pg_roles WHERE rolname IN ('migrator', 'app_runtime', 'core_data') ORDER BY rolname`;
  assert.deepEqual(roles.map((row) => row.rolname), ["app_runtime", "core_data", "migrator"]);
  assert.ok(roles.every((role) => !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole));

  const rights = await migrator.$queryRaw`
    SELECT
      has_table_privilege('core_data', 'platform.audit_log', 'INSERT') AS core_audit_insert,
      has_table_privilege('core_data', 'platform.audit_log', 'SELECT') AS core_audit_select,
      has_table_privilege('core_data', 'platform.audit_log', 'UPDATE') AS core_audit_update,
      has_table_privilege('core_data', 'platform.audit_log', 'DELETE') AS core_audit_delete,
      has_table_privilege('app_runtime', 'platform.audit_log', 'INSERT') AS app_audit_insert,
      has_table_privilege('app_runtime', 'platform.core_record', 'UPDATE') AS app_record_update,
      has_table_privilege('app_runtime', 'platform.attachment', 'INSERT') AS app_file_insert,
      has_table_privilege('core_data', 'platform.core_record', 'UPDATE') AS core_record_update,
      has_table_privilege('core_data', 'system.membership', 'SELECT') AS core_membership_select,
      has_table_privilege('core_data', 'system.membership', 'INSERT') AS core_membership_insert,
      has_table_privilege('core_data', 'platform.idempotency_record', 'SELECT') AS core_idempotency_select,
      has_table_privilege('app_runtime', 'platform.idempotency_record', 'SELECT') AS app_idempotency_select,
      has_table_privilege('app_runtime', 'platform.idempotency_record', 'INSERT') AS app_idempotency_insert,
      has_table_privilege('app_runtime', 'platform.idempotency_record', 'UPDATE') AS app_idempotency_update,
       has_table_privilege('app_runtime', 'platform.idempotency_record', 'DELETE') AS app_idempotency_delete,
       has_table_privilege('core_data', 'platform.outbox_message', 'SELECT') AS core_outbox_select,
       has_table_privilege('app_runtime', 'platform.outbox_message', 'SELECT') AS app_outbox_select,
       has_table_privilege('app_runtime', 'platform.outbox_message', 'INSERT') AS app_outbox_insert,
       has_table_privilege('app_runtime', 'platform.outbox_message', 'UPDATE') AS app_outbox_update,
       has_table_privilege('app_runtime', 'platform.outbox_message', 'DELETE') AS app_outbox_delete,
       has_table_privilege('app_runtime', 'system.organization', 'SELECT') AS app_org_select,
       has_table_privilege('app_runtime', 'system.organization', 'UPDATE') AS app_org_update,
       has_table_privilege('app_runtime', 'system.organization', 'INSERT') AS app_org_insert,
       has_table_privilege('app_runtime', 'system.partner', 'SELECT') AS app_partner_select,
       has_table_privilege('app_runtime', 'system.partner', 'INSERT') AS app_partner_insert,
       has_table_privilege('app_runtime', 'system.partner', 'UPDATE') AS app_partner_update,
       has_table_privilege('app_runtime', 'system.partner', 'DELETE') AS app_partner_delete,
       has_table_privilege('app_runtime', 'system.partner_connection', 'SELECT') AS app_conn_select,
       has_table_privilege('app_runtime', 'system.partner_connection', 'INSERT') AS app_conn_insert,
       has_table_privilege('app_runtime', 'system.partner_connection', 'UPDATE') AS app_conn_update,
       has_table_privilege('app_runtime', 'system.partner_connection', 'DELETE') AS app_conn_delete,
       has_table_privilege('app_runtime', 'catalog.product', 'SELECT') AS app_product_select,
       has_table_privilege('app_runtime', 'catalog.product', 'INSERT') AS app_product_insert,
       has_table_privilege('app_runtime', 'catalog.batch', 'UPDATE') AS app_batch_update,
       has_table_privilege('app_runtime', 'inventory.warehouse', 'SELECT') AS app_wh_select,
       has_table_privilege('app_runtime', 'inventory.stock_balance', 'UPDATE') AS app_balance_update,
       has_table_privilege('app_runtime', 'inventory.stock_movement', 'INSERT') AS app_movement_insert,
       has_table_privilege('app_runtime', 'inventory.stock_movement', 'UPDATE') AS app_movement_update,
       has_table_privilege('app_runtime', 'system.membership_warehouse', 'INSERT') AS app_mw_insert`;
  assert.deepEqual(rights[0], {
    core_audit_insert: true, core_audit_select: true,
    core_audit_update: false, core_audit_delete: false,
    app_audit_insert: true, app_record_update: false, app_file_insert: false,
    core_record_update: true, core_membership_select: true, core_membership_insert: false,
    core_idempotency_select: false, app_idempotency_select: true, app_idempotency_insert: true,
    app_idempotency_update: true, app_idempotency_delete: true,
    core_outbox_select: false, app_outbox_select: true, app_outbox_insert: true,
    app_outbox_update: true, app_outbox_delete: false,
    app_org_select: true, app_org_update: true, app_org_insert: false,
    app_partner_select: true, app_partner_insert: true, app_partner_update: true, app_partner_delete: false,
    app_conn_select: true, app_conn_insert: true, app_conn_update: true, app_conn_delete: false,
    app_product_select: true, app_product_insert: true, app_batch_update: true,
    app_wh_select: true, app_balance_update: true, app_movement_insert: true,
    app_movement_update: false, app_mw_insert: true,
  });
});

test("core repositories use injected client, CAS and database constraints", async () => {
  const records = coreRecordRepository(core);
  const files = attachmentRepository(core);
  const id = randomUUID();
  const sourceId = randomUUID();
  const payload = { schemaVersion: "1.0", reference: sourceId };
  const checksumHex = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const created = await records.create({
    id, kind: "evidence_metadata", sourceType: "document", sourceId, payload,
    visibility: "private", policyVersion: "v1", checksumHex, builtAt: new Date(),
  });
  assert.equal(created.version, 1);
  assert.equal((await records.findBySource("evidence_metadata", "document", sourceId)).id, id);
  assert.equal((await app.coreRecord.findUnique({ where: { id } })).id, id);

  const updated = await records.replaceIfVersion(id, 1, { payload: { ...payload, revision: 2 } });
  assert.equal(updated.version, 2);
  assert.equal(await records.replaceIfVersion(id, 1, { payload }), null);
  assert.equal((await records.findById(id)).payload.revision, 2);
  await assert.rejects(records.create({
    id: randomUUID(), kind: "evidence_metadata", sourceType: "document", sourceId,
    payload, visibility: "private", policyVersion: "v1", checksumHex, builtAt: new Date(),
  }), { code: "P2002" });
  await assert.rejects(records.create({
    id: randomUUID(), kind: "arbitrary_table", sourceType: "document", sourceId: randomUUID(),
    payload, visibility: "private", policyVersion: "v1", checksumHex, builtAt: new Date(),
  }));

  const file = await files.createPending({
    id: randomUUID(), ownerType: "core_record", ownerId: id,
    bucket: "quarantine", objectKey: `${randomUUID()}/file`, sha256Hex: checksumHex,
    mimeType: "application/pdf", sizeBytes: 42n, visibility: "private", createdBySub: "test-user",
  });
  assert.equal(file.scanState, "pending");
  assert.equal((await files.findById(file.id)).id, file.id);
  assert.equal((await files.updateIfVersion(file.id, 1, { ownerId: id })).version, 2);
  assert.equal(await files.updateIfVersion(file.id, 1, { ownerId: id }), null);
  await assert.rejects(app.coreRecord.update({ where: { id }, data: { policyVersion: "forbidden" } }));
  await assert.rejects(app.attachment.create({ data: {
    id: randomUUID(), ownerType: "core_record", ownerId: id,
    bucket: "quarantine", objectKey: `${randomUUID()}/file`, sha256Hex: checksumHex,
    mimeType: "application/pdf", sizeBytes: 42n, scanState: "pending", createdBySub: "test-user",
  } }));
});

test("core can append audit with bounded correlation but cannot mutate it", async () => {
  const id = randomUUID();
  const audit = {
    id, clientId: "core-data-test", action: "core.record.create",
    targetType: "core_record", targetId: randomUUID(), outcome: "success",
    requestId: randomUUID(), correlationId: randomUUID(),
    beforeSummary: {}, afterSummary: { fields: ["kind"] },
  };
  await core.auditLog.create({ data: audit });
  assert.equal((await app.auditLog.findUnique({ where: { id } })).id, id);
  await assert.rejects(core.auditLog.update({ where: { id }, data: { action: "tamper" } }));
  await assert.rejects(core.auditLog.delete({ where: { id } }));
  await assert.rejects(core.auditLog.create({ data: {
    ...audit, id: randomUUID(), correlationId: "x".repeat(129),
  } }));
});

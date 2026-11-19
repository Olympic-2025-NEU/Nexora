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
  assert.deepEqual(tables.map((row) => row.table_name), ["attachment", "audit_log", "core_record"]);

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
  ]);
  assert.deepEqual(byTable("core_record"), [
    "id", "created_at", "updated_at", "version", "kind", "source_type", "source_id",
    "payload", "visibility", "policy_version", "checksum_hex", "built_at",
  ]);

  const constraints = await migrator.$queryRaw`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('platform.audit_log'::regclass,
                       'platform.attachment'::regclass,
                       'platform.core_record'::regclass)`;
  const names = new Set(constraints.map((row) => row.conname));
  for (const name of [
    "audit_log_actor_check", "audit_log_outcome_check", "audit_log_correlation_id_check",
    "attachment_sha256_check", "attachment_size_check", "attachment_scan_state_check",
    "attachment_upload_hash_pair_check", "attachment_upload_key_hash_check", "attachment_upload_payload_hash_check",
    "core_record_kind_check", "core_record_checksum_check",
  ]) assert.ok(names.has(name), `missing constraint ${name}`);

  const migrations = await migrator.$queryRaw`
    SELECT migration_name FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.ok(migrations.some((row) => row.migration_name === "20261118020000_platform_core_audit_grant"));
  assert.ok(migrations.some((row) => row.migration_name === "20261119000000_file_upload_idempotency"));
  const stock = await migrator.$queryRaw`
    SELECT to_regclass('inventory.stock_balance')::text AS relation`;
  assert.equal(stock[0].relation, null, "P03 must not create P06 stock tables");
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
      has_table_privilege('core_data', 'system.membership', 'INSERT') AS core_membership_insert`;
  assert.deepEqual(rights[0], {
    core_audit_insert: true, core_audit_select: true,
    core_audit_update: false, core_audit_delete: false,
    app_audit_insert: true, app_record_update: false, app_file_insert: false,
    core_record_update: true, core_membership_select: true, core_membership_insert: false,
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

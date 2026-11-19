// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createRecordService } from '../../services/core-data/records/service.mjs';
import { handleRecordRequest } from '../../services/core-data/records/http.mjs';

const title = 'Private inspection evidence';

function evidence(ownerId, attachmentId) {
  return { kind: 'evidence_metadata', payload: { schemaVersion: 1,
    ownerType: 'membership', ownerId, attachmentId, title } };
}

function fixture() {
  const organizationId = randomUUID();
  const owner = { sub: `owner-${randomUUID()}`, role: 'staff',
    membershipId: randomUUID(), organizationId };
  const colleague = { sub: `colleague-${randomUUID()}`, role: 'staff',
    membershipId: randomUUID(), organizationId };
  const outsider = { sub: `outsider-${randomUUID()}`, role: 'staff',
    membershipId: randomUUID(), organizationId: randomUUID() };
  const attachmentId = randomUUID();
  const attachments = new Map([[attachmentId, { id: attachmentId, ownerType: 'core_record',
    ownerId: null, scanState: 'clean', bucket: 'private', visibility: 'private',
    createdBySub: owner.sub }]]);
  const members = new Map([owner, colleague, outsider].map((actor) => [actor.membershipId,
    { id: actor.membershipId, organizationId: actor.organizationId, status: 'active' }]));
  const organizations = new Map([organizationId, outsider.organizationId].map((id) =>
    [id, { id, status: 'active' }]));
  const rows = new Map();
  const audits = [];
  function client(target, targetAudits) {
    return {
      membership: { findUnique: async ({ where }) => members.get(where.id) ?? null },
      organization: { findUnique: async ({ where }) => organizations.get(where.id) ?? null },
      attachment: { findUnique: async ({ where }) => attachments.get(where.id) ?? null },
      coreRecord: {
        findUnique: async ({ where }) => where.id ? target.get(where.id) ?? null :
          [...target.values()].find((row) => row.kind === where.kind_sourceType_sourceId.kind &&
            row.sourceType === where.kind_sourceType_sourceId.sourceType &&
            row.sourceId === where.kind_sourceType_sourceId.sourceId) ?? null,
        create: async ({ data }) => {
          const row = { ...data, version: 1 };
          target.set(row.id, row);
          return row;
        },
      },
      auditLog: { create: async ({ data }) => { targetAudits.push(data); } },
    };
  }
  return { ...client(rows, audits), owner, colleague, outsider, attachmentId, attachments,
    members, rows, audits,
    $transaction: async (work) => {
      const staged = new Map(rows);
      const stagedAudits = [];
      const result = await work(client(staged, stagedAudits));
      rows.clear();
      for (const [id, row] of staged) rows.set(id, row);
      audits.push(...stagedAudits);
      return result;
    } };
}

test('private evidence: real membership, owner access, IDOR and audit', async () => {
  const db = fixture();
  const service = createRecordService(db);
  const requestId = randomUUID();
  const input = evidence(db.owner.membershipId, db.attachmentId);
  const created = await service.create({ actor: db.owner, input,
    idempotencyKey: randomUUID(), requestId });
  assert.equal(created.status, 201);
  assert.equal(created.data.visibility, 'private');
  assert.deepEqual((await service.get({ actor: db.owner, id: created.data.id })).payload, input.payload);
  for (const actor of [db.colleague, db.outsider]) {
    await assert.rejects(service.get({ actor, id: created.data.id }),
      { code: 'RECORD_NOT_FOUND', status: 404 });
  }
  assert.equal(db.rows.size, 1);
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].action, 'core_record.create');
  assert.equal(db.audits[0].targetId, created.data.id);
  assert.equal(db.audits[0].requestId, requestId);
  assert.equal(db.audits[0].actorSub, db.owner.sub);
});

test('reject unscanned or foreign attachments before create without orphan rows', async () => {
  const db = fixture();
  const service = createRecordService(db);
  const input = evidence(db.owner.membershipId, db.attachmentId);
  for (const scanState of ['pending', 'infected', 'error']) {
    db.attachments.get(db.attachmentId).scanState = scanState;
    await assert.rejects(service.create({ actor: db.owner, input,
      idempotencyKey: randomUUID(), requestId: randomUUID() }),
    { code: 'ATTACHMENT_NOT_CLEAN', status: 422 });
  }
  const attachment = db.attachments.get(db.attachmentId);
  attachment.scanState = 'clean';
  attachment.createdBySub = db.colleague.sub;
  await assert.rejects(service.create({ actor: db.owner, input,
    idempotencyKey: randomUUID(), requestId: randomUUID() }),
  { code: 'ATTACHMENT_NOT_FOUND', status: 404 });
  assert.equal(db.rows.size, 0);
  assert.equal(db.audits.length, 0);
});

test('GET rechecks private attachment and owner; denied HTTP never exposes payload or audits', async () => {
  const db = fixture();
  const service = createRecordService(db);
  const created = await service.create({ actor: db.owner,
    input: evidence(db.owner.membershipId, db.attachmentId),
    idempotencyKey: randomUUID(), requestId: randomUUID() });
  const server = createServer(async (req, res) => {
    await handleRecordRequest(req, res, { authenticate: async () => db.owner, records: service });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/records/${created.data.id}`;
    const get = async () => {
      const response = await fetch(url);
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await get()).status, 200);
    const attachment = db.attachments.get(db.attachmentId);
    for (const state of ['pending', 'infected', 'error']) {
      attachment.scanState = state;
      const denied = await get();
      assert.equal(denied.status, 422);
      assert.equal(denied.body.code, 'ATTACHMENT_NOT_CLEAN');
      assert.equal('data' in denied.body, false);
      assert.equal(JSON.stringify(denied.body).includes(title), false);
    }
    attachment.scanState = 'clean';
    for (const change of [
      () => { attachment.bucket = 'quarantine'; },
      () => { attachment.visibility = 'public'; },
      () => { attachment.ownerType = 'membership'; },
      () => { attachment.ownerId = db.colleague.membershipId; },
      () => { attachment.createdBySub = db.colleague.sub; },
      () => { db.attachments.delete(db.attachmentId); },
    ]) {
      change();
      const denied = await get();
      assert.equal(denied.status, 404);
      assert.equal(denied.body.code, 'ATTACHMENT_NOT_FOUND');
      assert.equal('data' in denied.body, false);
      assert.equal(JSON.stringify(denied.body).includes(title), false);
      Object.assign(attachment, { bucket: 'private', visibility: 'private',
        ownerType: 'core_record', ownerId: null, createdBySub: db.owner.sub });
    }
    assert.equal(db.audits.length, 1);
    assert.equal(db.rows.size, 1);
    db.attachments.set(db.attachmentId, attachment);
    db.members.get(db.owner.membershipId).status = 'disabled';
    await assert.rejects(service.get({ actor: db.owner, id: created.data.id }),
      { code: 'RECORD_NOT_FOUND', status: 404 });
    assert.equal(db.audits.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PostgreSQL: owned private evidence, scan revocation, IDOR and audit', {
  skip: process.env.NEXORA_TEST_EVIDENCE !== '1'
    ? 'Requires isolated DATABASE_URL and CORE_DATABASE_URL' : false,
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  assert.ok(process.env.DATABASE_URL && process.env.CORE_DATABASE_URL);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const core = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
  try {
    const organization = await admin.organization.create({ data: { id: randomUUID(),
      instanceId: `evidence-${randomUUID()}`, code: `evidence-${randomUUID().slice(0, 8)}`,
      name: 'Core evidence integration', status: 'active' } });
    const createMember = async (role) => admin.membership.create({ data: {
      id: randomUUID(), organizationId: organization.id, keycloakSub: `evidence-${randomUUID()}`,
      displayName: 'Core evidence integration', role, status: 'active' } });
    const member = await createMember('staff');
    const other = await createMember('staff');
    const actor = (row) => ({ sub: row.keycloakSub, membershipId: row.id,
      organizationId: row.organizationId, role: row.role });
    const attachment = await admin.attachment.create({ data: { id: randomUUID(),
      ownerType: 'core_record', bucket: 'private', objectKey: `evidence/${randomUUID()}`,
      sha256Hex: 'a'.repeat(64), mimeType: 'text/plain', sizeBytes: 1n,
      scanState: 'clean', visibility: 'private', createdBySub: member.keycloakSub } });
    const service = createRecordService(core);
    const input = evidence(member.id, attachment.id);
    const requestId = randomUUID();
    const created = await service.create({ actor: actor(member), input,
      idempotencyKey: randomUUID(), requestId });
    assert.equal((await service.get({ actor: actor(member), id: created.data.id })).id, created.data.id);
    await assert.rejects(service.get({ actor: actor(other), id: created.data.id }),
      { code: 'RECORD_NOT_FOUND', status: 404 });
    assert.equal(await admin.auditLog.count({ where: { requestId, targetId: created.data.id,
      action: 'core_record.create', actorSub: member.keycloakSub } }), 1);
    for (const scanState of ['pending', 'infected', 'error']) {
      await admin.attachment.update({ where: { id: attachment.id }, data: { scanState } });
      const rejectedId = randomUUID();
      await assert.rejects(service.create({ actor: actor(member), input,
        idempotencyKey: randomUUID(), requestId: rejectedId }),
      { code: 'ATTACHMENT_NOT_CLEAN', status: 422 });
      await assert.rejects(service.get({ actor: actor(member), id: created.data.id }),
        { code: 'ATTACHMENT_NOT_CLEAN', status: 422 });
      assert.equal(await admin.auditLog.count({ where: { requestId: rejectedId } }), 0);
    }
    await admin.attachment.update({ where: { id: attachment.id }, data: {
      scanState: 'clean', createdBySub: other.keycloakSub } });
    const deniedId = randomUUID();
    await assert.rejects(service.create({ actor: actor(member), input,
      idempotencyKey: randomUUID(), requestId: deniedId }),
    { code: 'ATTACHMENT_NOT_FOUND', status: 404 });
    await assert.rejects(service.get({ actor: actor(member), id: created.data.id }),
      { code: 'ATTACHMENT_NOT_FOUND', status: 404 });
    assert.equal(await admin.auditLog.count({ where: { requestId: deniedId } }), 0);
    await admin.attachment.delete({ where: { id: attachment.id } });
    await assert.rejects(service.get({ actor: actor(member), id: created.data.id }),
      { code: 'ATTACHMENT_NOT_FOUND', status: 404 });
    assert.equal(await admin.coreRecord.count(), 1);
    assert.equal(await admin.auditLog.count({ where: { targetId: created.data.id } }), 1);
    const rollbackId = randomUUID();
    const failing = createRecordService({ $transaction: (work) => core.$transaction((tx) =>
      work({ coreRecord: tx.coreRecord, membership: tx.membership,
        organization: tx.organization, attachment: tx.attachment,
        auditLog: { create: async () => { throw new Error('audit unavailable'); } } })) });
    const replacement = await admin.attachment.create({ data: { id: randomUUID(),
      ownerType: 'core_record', bucket: 'private', objectKey: `evidence/${randomUUID()}`,
      sha256Hex: 'a'.repeat(64), mimeType: 'text/plain', sizeBytes: 1n,
      scanState: 'clean', visibility: 'private', createdBySub: member.keycloakSub } });
    await assert.rejects(failing.create({ actor: actor(member),
      input: evidence(member.id, replacement.id), idempotencyKey: randomUUID(),
      requestId: rollbackId }), /audit unavailable/);
    assert.equal(await admin.coreRecord.count(), 1);
    assert.equal(await admin.auditLog.count({ where: { requestId: rollbackId } }), 0);
  } finally {
    await Promise.all([admin.$disconnect(), core.$disconnect()]);
  }
});

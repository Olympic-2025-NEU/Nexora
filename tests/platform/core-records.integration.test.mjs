// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import canonicalize from 'canonicalize';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthenticator } from '../../services/core-data/auth.mjs';
import { createRecordService } from '../../services/core-data/records/service.mjs';
import { handleRecordRequest } from '../../services/core-data/records/http.mjs';
import { authorizeEvidence, authorizeKind, RecordError } from '../../services/core-data/records/policy.mjs';
import { validateRecord } from '../../services/core-data/records/schema.mjs';

const actor = { sub: 'test-staff', actorSub: 'test-staff', role: 'staff',
  membershipId: randomUUID(), organizationId: randomUUID() };
const attachmentId = randomUUID();
const payload = { schemaVersion: 1, ownerType: 'membership', ownerId: actor.membershipId,
  attachmentId, title: 'Inspection report' };
const input = { kind: 'evidence_metadata', payload };
const key = randomUUID();

function fixture() {
  const rows = new Map();
  const audits = [];
  let failAudit = false;
  const access = {
    membership: { findUnique: async ({ where }) => where.id === actor.membershipId
      ? { id: actor.membershipId, organizationId: actor.organizationId, status: 'active' } : null },
    organization: { findUnique: async ({ where }) => where.id === actor.organizationId
      ? { id: actor.organizationId, status: 'active' } : null },
    attachment: { findUnique: async ({ where }) => where.id === attachmentId
      ? { id: attachmentId, ownerType: 'core_record', ownerId: null, scanState: 'clean',
        bucket: 'private', visibility: 'private', createdBySub: actor.sub } : null },
  };
  function client(target, targetAudits) {
    return { ...access,
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
        updateMany: async ({ where, data }) => {
          const row = target.get(where.id);
          if (!row || row.version !== where.version) return { count: 0 };
          target.set(row.id, { ...row, ...data, version: row.version + 1 });
          return { count: 1 };
        },
        findUniqueOrThrow: async ({ where }) => target.get(where.id),
      },
      auditLog: { create: async ({ data }) => {
        if (failAudit) throw new Error('audit unavailable');
        targetAudits.push(data);
      } },
    };
  }
  return { ...client(rows, audits), rows, audits, access,
    setFailAudit: (value) => { failAudit = value; },
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

test('four versioned schemas and strict envelope fail closed', () => {
  for (const kind of ['evidence_metadata', 'trace_projection', 'ot_reading', 'archive_manifest']) {
    const fixture = JSON.parse(requireFixture(kind));
    assert.equal(validateRecord({ kind, payload: fixture.valid }).kind, kind);
    assert.throws(() => validateRecord({ kind, payload: fixture.invalid }), { status: 422 });
    assert.throws(() => validateRecord({ kind, payload: { ...fixture.valid, schemaVersion: 2 } }), { status: 422 });
  }
  for (const invalid of [null, { ...input, role: 'administrator' },
    { ...input, sourceId: randomUUID() }, { ...input, visibility: 'public' },
    { ...input, payload: { ...payload, extra: true } }, { kind: 'other', payload }]) {
    assert.throws(() => validateRecord(invalid), { status: 422 });
  }
});

function requireFixture(kind) {
  const pairs = {
    evidence_metadata: { valid: payload, invalid: { ...payload, title: '' } },
    trace_projection: { valid: { schemaVersion: 1, originLot: { issuerInstanceId: 'a', lotId: randomUUID() },
      sourceEventIds: [], nodes: [], edges: [], transformVersion: 'v1', asOf: '2026-11-19T00:00:00Z' } },
    ot_reading: { valid: { schemaVersion: 1, deviceId: 'sim', readingId: '1', batchId: randomUUID(),
      metric: 'temperature_c', value: '1.0', unit: 'C', observedAt: '2026-11-19T00:00:00Z',
      qualityState: 'accepted', simulated: true } },
    archive_manifest: { valid: { schemaVersion: 1, objectKey: 'a', sha256Hex: 'a'.repeat(64),
      recordCount: 1, firstOccurredAt: '2026-11-19T00:00:00Z', lastOccurredAt: '2026-11-19T00:00:00Z',
      sourceMinId: 'a', sourceMaxId: 'b', exportedAt: '2026-11-19T00:00:00Z', checkpoint: 'a', format: 'jsonl' } },
  };
  const pair = pairs[kind];
  return JSON.stringify({ valid: pair.valid, invalid: pair.invalid ?? { ...pair.valid, extra: true } });
}

test('writer and owner/attachment checks deny unknown and unscanned resources', async () => {
  const db = fixture();
  assert.throws(() => authorizeKind({ ...actor, role: 'viewer' }, input.kind, 'create'), { status: 403 });
  for (const kind of ['trace_projection', 'ot_reading', 'archive_manifest']) {
    assert.throws(() => authorizeKind(actor, kind, 'create'), { status: 403 });
  }
  await authorizeEvidence({ membership: (id) => db.access.membership.findUnique({ where: { id } }),
    organization: (id) => db.access.organization.findUnique({ where: { id } }),
    attachment: (id) => db.access.attachment.findUnique({ where: { id } }) }, actor, payload, 'create');
  const records = createRecordService(db);
  for (const bad of [
    { ...payload, ownerType: 'document' }, { ...payload, ownerType: 'batch' },
    { ...payload, ownerId: randomUUID() }, { ...payload, attachmentId: randomUUID() },
  ]) await assert.rejects(records.create({ actor, input: { ...input, payload: bad }, idempotencyKey: key,
    requestId: 'bad' }), { status: bad.ownerType === 'document' || bad.ownerType === 'batch' ? 422 : 404 });
  await assert.rejects(records.create({ actor: { ...actor, sub: 'other' }, input, idempotencyKey: key,
    requestId: 'bad' }), { status: 404 });
  db.access.attachment.findUnique = async ({ where }) => where.id === attachmentId
    ? { id: attachmentId, ownerType: 'core_record', ownerId: null, scanState: 'pending',
      bucket: 'private', visibility: 'private', createdBySub: actor.sub } : null;
  await assert.rejects(records.create({ actor, input, idempotencyKey: key, requestId: 'bad' }),
    { code: 'ATTACHMENT_NOT_CLEAN', status: 422 });
});

test('create/get, JCS hash, durable retry, conflict and audit rollback', async () => {
  const db = fixture();
  const service = createRecordService(db);
  const create = (value = input, opts = {}) => service.create({ actor, input: value,
    idempotencyKey: key, requestId: 'record-request', ...opts });
  await assert.rejects(create(input, { idempotencyKey: undefined }), { status: 422 });
  db.setFailAudit(true);
  await assert.rejects(create(), /audit unavailable/);
  assert.equal(db.rows.size, 0);
  assert.equal(db.audits.length, 0);
  db.setFailAudit(false);
  const first = await create();
  assert.equal(first.status, 201);
  assert.equal(first.data.visibility, 'private');
  assert.equal(db.rows.values().next().value.sourceType, 'evidence');
  assert.equal(db.rows.values().next().value.policyVersion, 'v1');
  assert.equal(first.data.checksum, createHash('sha256').update(canonicalize(payload)).digest('hex'));
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].actorSub, actor.sub);
  assert.equal((await service.get({ actor, id: first.data.id })).id, first.data.id);
  const reordered = { kind: input.kind, payload: { title: payload.title, attachmentId,
    ownerId: payload.ownerId, ownerType: payload.ownerType, schemaVersion: 1 } };
  assert.deepEqual((await create(reordered)).data.id, first.data.id);
  assert.equal((await create()).status, 200);
  assert.equal(db.audits.length, 1);
  await assert.rejects(create({ ...input, payload: { ...payload, title: 'Other' } }), { status: 409 });
  await assert.rejects(create(input, { ifMatch: 2 }), { status: 409 });
  const changed = { ...input, payload: { ...payload, title: 'Other' } };
  db.setFailAudit(true);
  await assert.rejects(create(changed, { ifMatch: 1 }), /audit unavailable/);
  assert.equal(db.rows.values().next().value.version, 1);
  db.setFailAudit(false);
  assert.equal((await create(changed, { ifMatch: 1 })).data.version, 2);
  assert.equal(db.audits[1].action, 'core_record.update');
  await assert.rejects(create(changed, { ifMatch: 1 }), { status: 409 });
  await assert.rejects(create({ ...input, payload: { ...changed.payload, ownerId: actor.organizationId,
    ownerType: 'organization' } }, { ifMatch: 2 }), { status: 403 });
  await assert.rejects(service.get({ actor, id: randomUUID() }), { status: 404 });
});

test('HTTP route authenticates, validates and returns requestId', async () => {
  const db = fixture();
  const records = createRecordService(db);
  const server = createServer(async (req, res) => {
    if (!await handleRecordRequest(req, res, { authenticate: async (request) => {
      if (request.headers.authorization !== 'Bearer test') throw new RecordError('TOKEN_MISSING', 401);
      return actor;
    }, records })) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/records`;
  const post = (value, headers = {}) => fetch(url, { method: 'POST', headers: {
    authorization: 'Bearer test', 'content-type': 'application/json', 'idempotency-key': key,
    'x-request-id': 'test-request', ...headers }, body: JSON.stringify(value) });
  assert.equal((await post(input, { authorization: '' })).status, 401);
  assert.equal((await post({ ...input, sourceType: 'fake' })).status, 422);
  assert.equal((await post(input, { 'if-match': 'W/"1"' })).status, 422);
  const created = await post(input);
  assert.equal(created.status, 201);
  const result = await created.json();
  assert.equal(result.requestId, 'test-request');
  assert.equal(created.headers.get('x-request-id'), 'test-request');
  assert.equal(created.headers.get('etag'), '"1"');
  assert.equal((await fetch(`${url}/${result.data.id}`, { headers: { authorization: 'Bearer test' } })).status, 200);
  assert.equal((await post(input)).status, 200);
});

test('OIDC actor uses verified sub and active database membership, never role headers', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'records-key', alg: 'RS256', use: 'sig' };
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let active = true;
    const authenticate = createAuthenticator({ membership: { findUnique: async ({ where }) =>
      where.keycloakSub === actor.sub ? { id: actor.membershipId, keycloakSub: actor.sub,
        role: 'staff', organizationId: actor.organizationId, status: active ? 'active' : 'disabled',
        organization: { status: 'active' } } : null } }, {
      OIDC_JWKS_URL: `http://127.0.0.1:${server.address().port}/jwks`,
      OIDC_ISSUER_URL: 'https://records.test/realm', OIDC_AUDIENCE: 'core',
    });
    const signed = (audience) => new SignJWT({ sub: actor.sub, role: 'administrator' })
      .setProtectedHeader({ alg: 'RS256', kid: 'records-key' })
      .setIssuer('https://records.test/realm').setAudience(audience)
      .setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const valid = await signed('core');
    assert.deepEqual(await authenticate({ headers: { authorization: `Bearer ${valid}` } }), actor);
    await assert.rejects(authenticate({ headers: { authorization: `Bearer ${valid}`,
      'x-userinfo': 'administrator' } }), { status: 403 });
    await assert.rejects(authenticate({ headers: { authorization: `Bearer ${await signed('wrong')}` } }),
      { status: 401 });
    active = false;
    await assert.rejects(authenticate({ headers: { authorization: `Bearer ${valid}` } }), { status: 403 });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('PostgreSQL: record, idempotency and audit share core_data transaction', {
  skip: process.env.NEXORA_TEST_RECORDS !== '1' ? 'Requires isolated DATABASE_URL and CORE_DATABASE_URL' : false,
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  assert.ok(process.env.DATABASE_URL && process.env.CORE_DATABASE_URL);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const core = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
  try {
    const organization = await admin.organization.findFirst({ where: { status: 'active' } });
    assert.ok(organization, 'Isolated test DB needs an active organization');
    const sub = `core-record-${randomUUID()}`;
    const member = await admin.membership.create({ data: { id: randomUUID(), organizationId: organization.id,
      keycloakSub: sub, displayName: 'Core records integration', role: 'staff', status: 'active' } });
    const attachment = await admin.attachment.create({ data: { id: randomUUID(), ownerType: 'core_record',
      bucket: 'private', objectKey: `test/${randomUUID()}`, sha256Hex: 'a'.repeat(64),
      mimeType: 'text/plain', sizeBytes: 1n, scanState: 'clean', visibility: 'private', createdBySub: sub } });
    const requester = { sub, actorSub: sub, membershipId: member.id, organizationId: organization.id, role: 'staff' };
    const service = createRecordService(core);
    const value = { kind: 'evidence_metadata', payload: { schemaVersion: 1, ownerType: 'membership',
      ownerId: member.id, attachmentId: attachment.id, title: 'Integration' } };
    const requestId = randomUUID();
    const requestKey = randomUUID();
    const first = await service.create({ actor: requester, input: value, idempotencyKey: requestKey, requestId });
    assert.equal(first.status, 201);
    assert.equal((await service.get({ actor: requester, id: first.data.id })).id, first.data.id);
    assert.equal((await admin.auditLog.count({ where: { requestId, targetId: first.data.id } })), 1);
    assert.equal((await service.create({ actor: requester, input: value, idempotencyKey: requestKey,
      requestId })).status, 200);
    await assert.rejects(service.create({ actor: requester, input: { ...value,
      payload: { ...value.payload, title: 'Changed' } }, idempotencyKey: requestKey, requestId }), { status: 409 });
    const changed = await service.create({ actor: requester, input: { ...value,
      payload: { ...value.payload, title: 'Changed' } }, idempotencyKey: requestKey, ifMatch: 1, requestId });
    assert.equal(changed.data.version, 2);
    assert.equal((await admin.auditLog.count({ where: { requestId, targetId: first.data.id } })), 2);
    const count = await admin.coreRecord.count();
    const failRequestId = randomUUID();
    const failing = createRecordService({ $transaction: (work) => core.$transaction((tx) =>
      work({ coreRecord: tx.coreRecord, membership: tx.membership,
        organization: tx.organization, attachment: tx.attachment,
        auditLog: { create: async () => { throw new Error('audit unavailable'); } } })) });
    await assert.rejects(failing.create({ actor: requester, input: value,
      idempotencyKey: randomUUID(), requestId: failRequestId }), /audit unavailable/);
    assert.equal(await admin.coreRecord.count(), count);
    assert.equal(await admin.auditLog.count({ where: { requestId: failRequestId } }), 0);
  } finally { await Promise.all([admin.$disconnect(), core.$disconnect()]); }
});

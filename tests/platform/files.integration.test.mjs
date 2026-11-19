// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthenticator } from '../../services/core-data/auth.mjs';
import { createFileService } from '../../services/core-data/files/upload-service.mjs';
import { handleFileRequest } from '../../services/core-data/files/http.mjs';
import { createS3FileStore } from '../../services/core-data/files/s3-store.mjs';
import { reconcileFiles } from '../../services/core-data/files/reconcile.mjs';

if (process.env.NEXORA_TEST_FILES !== '1' || !process.env.DATABASE_URL ||
    !process.env.CORE_DATABASE_URL || !process.env.NEXORA_TEST_S3_CONTAINER) {
  throw new Error('File integration tests require isolated PostgreSQL and SeaweedFS');
}
const connect = (url) => new PrismaClient({ datasources: { db: { url } } });
const admin = connect(process.env.DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
const store = createS3FileStore(process.env);
const files = createFileService(core, store);
const server = createServer();
const jwksServer = createServer();
after(async () => {
  await Promise.all([admin.$disconnect(), core.$disconnect()]);
  await Promise.all([new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => jwksServer.close(resolve))]);
});

async function listen(serverToStart) {
  await new Promise((resolve) => serverToStart.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${serverToStart.address().port}`;
}

async function waitForStorage(probeStore = store) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if (!await probeStore.exists('quarantine', `probe-${randomUUID()}`)) return; }
    catch (error) { lastError = `${error.name}:${error.$metadata?.httpStatusCode ?? 'offline'}`; }
    await delay(1000);
  }
  throw new Error(`SeaweedFS did not become ready (${lastError})`);
}

async function objectKeys() {
  const keys = [];
  for await (const object of store.listQuarantine()) keys.push(object.key);
  return keys;
}

test('Core File API: OIDC, quarantine, idempotency, privacy, compensation and restart', async () => {
  await waitForStorage();
  const organizationId = randomUUID();
  await admin.organization.create({ data: { id: organizationId, instanceId: 'a',
    code: 'T04', name: 'File test organization' } });
  for (const [sub, role] of [['t04-staff', 'staff'], ['t04-other', 'staff'], ['t04-viewer', 'viewer']]) {
    await admin.membership.create({ data: { id: randomUUID(), organizationId,
      keycloakSub: sub, displayName: sub, role, status: 'active' } });
  }
  await assert.rejects(core.membership.create({ data: { id: randomUUID(), organizationId,
    keycloakSub: 'forbidden-core-write', displayName: 'forbidden', role: 'staff', status: 'active',
  } }));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 't04-test-key', alg: 'RS256', use: 'sig' };
  jwksServer.on('request', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksUrl = await listen(jwksServer);
  const issuer = 'https://nexora-t04.test/realms/nexora';
  const authenticate = createAuthenticator(core, {
    OIDC_JWKS_URL: `${jwksUrl}/jwks`, OIDC_ISSUER_URL: issuer, OIDC_AUDIENCE: 'nexora',
  });
  const token = (sub, audience = 'nexora') => new SignJWT({ sub })
    .setProtectedHeader({ alg: 'RS256', kid: 't04-test-key' })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const staffToken = await token('t04-staff');
  const otherToken = await token('t04-other');
  const viewerToken = await token('t04-viewer');
  server.on('request', async (req, res) => {
    if (!await handleFileRequest(req, res, { authenticate, files })) {
      res.writeHead(404); res.end();
    }
  });
  const baseUrl = await listen(server);
  const form = (text, type = 'text/plain') => {
    const data = new FormData();
    data.set('file', new Blob([text], { type }), 'evidence.txt');
    return data;
  };
  const upload = (body, key = randomUUID(), authorization = `Bearer ${staffToken}`) =>
    fetch(`${baseUrl}/api/v1/files`, { method: 'POST', headers: {
      authorization, 'idempotency-key': key,
    }, body });

  assert.equal((await upload(form('anonymous'), randomUUID(), '')).status, 401);
  assert.equal((await upload(form('wrong role'), randomUUID(), `Bearer ${viewerToken}`)).status, 403);
  assert.equal((await upload(form('wrong audience'), randomUUID(), `Bearer ${await token('t04-staff', 'other')}`)).status, 401);
  const forged = await fetch(`${baseUrl}/api/v1/files`, { method: 'POST',
    headers: { authorization: `Bearer ${staffToken}`, 'idempotency-key': randomUUID(), 'x-userinfo': 'forged' },
    body: form('forged') });
  assert.equal(forged.status, 403);
  assert.equal((await upload(form('<script>alert(1)</script>', 'text/html'))).status, 422);
  assert.equal((await upload(form('not a PDF', 'application/pdf'))).status, 422);
  const publicForm = form('private only');
  publicForm.set('visibility', 'public');
  assert.equal((await upload(publicForm)).status, 422);

  const key = randomUUID();
  const content = 'quarantined test evidence';
  const created = await upload(form(content), key);
  assert.equal(created.status, 202);
  const accepted = (await created.json()).data;
  assert.equal(accepted.scanState, 'pending');
  const row = await core.attachment.findUniqueOrThrow({ where: { id: accepted.id } });
  assert.equal(row.bucket, 'quarantine');
  assert.equal(row.ownerId, null);
  assert.equal(row.visibility, 'private');
  assert.match(row.objectKey, /^pending\/[0-9a-f-]{36}$/);
  assert.equal(row.sha256Hex, createHash('sha256').update(content).digest('hex'));
  assert.equal((await store.get('quarantine', row.objectKey)).toString(), content);
  assert.equal((await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_QUARANTINE}/${row.objectKey}`)).status, 403);
  assert.equal(await core.auditLog.count({ where: { action: 'file.upload', targetId: accepted.id } }), 1);
  const metadata = await fetch(`${baseUrl}/api/v1/files/${accepted.id}`, {
    headers: { authorization: `Bearer ${staffToken}` },
  });
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).data.checksum, row.sha256Hex);
  assert.equal((await fetch(`${baseUrl}/api/v1/files/${accepted.id}?download=1`, {
    headers: { authorization: `Bearer ${staffToken}` },
  })).status, 423);
  assert.equal((await fetch(`${baseUrl}/api/v1/files/${accepted.id}`, {
    headers: { authorization: `Bearer ${otherToken}` },
  })).status, 404);
  assert.equal((await upload(form(content), key)).status, 202);
  assert.equal((await upload(form('different bytes'), key)).status, 409);
  assert.equal(await core.attachment.count(), 1);

  const beforeFailure = await objectKeys();
  await admin.$executeRawUnsafe('REVOKE INSERT ON TABLE "platform"."attachment" FROM core_data');
  try {
    const failed = await upload(form('PG must fail'));
    assert.equal(failed.status, 503);
  } finally {
    await admin.$executeRawUnsafe('GRANT INSERT ON TABLE "platform"."attachment" TO core_data');
  }
  assert.deepEqual(await objectKeys(), beforeFailure);
  assert.equal(await core.attachment.count(), 1);
  const brokenStore = createS3FileStore({ ...process.env, S3_SECRET_KEY: 'wrong-test-secret' });
  await assert.rejects(createFileService(core, brokenStore).upload({ actor: { sub: 't04-staff', role: 'staff' },
    body: Buffer.from('S3 must fail'), declaredType: 'text/plain',
    idempotencyKey: randomUUID(), requestId: randomUUID() }));
  assert.equal(await core.attachment.count(), 1);

  const orphan = `pending/${randomUUID()}`;
  await store.putQuarantine(orphan, Buffer.from('orphan'), 'text/plain',
    createHash('sha256').update('orphan').digest('hex'));
  const future = new Date(Date.now() + 20 * 60_000);
  assert.equal((await reconcileFiles(core, store, { now: future })).orphanObjects, 1);
  assert.equal(await store.exists('quarantine', orphan), false);
  assert.equal((await reconcileFiles(core, store, { now: future })).orphanObjects, 0);
  await store.delete('quarantine', row.objectKey);
  assert.equal((await reconcileFiles(core, store, { now: future })).missingObjects, 1);
  assert.equal((await core.attachment.findUniqueOrThrow({ where: { id: accepted.id } })).scanState, 'error');
  assert.equal((await reconcileFiles(core, store, { now: future })).missingObjects, 0);
  const lateReplay = await upload(form(content), key);
  assert.equal(lateReplay.status, 202);
  assert.deepEqual((await lateReplay.json()).data, accepted);

  const cleanId = randomUUID();
  const cleanKey = `clean/${randomUUID()}`;
  const cleanBody = Buffer.from('approved clean evidence');
  const cleanHash = createHash('sha256').update(cleanBody).digest('hex');
  await store.put('private', cleanKey, cleanBody, 'text/plain', cleanHash);
  await admin.attachment.create({ data: { id: cleanId, ownerType: 'core_record',
    bucket: 'private', objectKey: cleanKey, sha256Hex: cleanHash, mimeType: 'text/plain',
    sizeBytes: BigInt(cleanBody.length), scanState: 'clean', visibility: 'private',
    createdBySub: 't04-staff', scannedAt: new Date(), scanEngineVersion: 'test-fixture',
  } });
  const cleanResponse = await fetch(`${baseUrl}/api/v1/files/${cleanId}?download=1`, {
    headers: { authorization: `Bearer ${staffToken}` },
  });
  assert.equal(cleanResponse.status, 200);
  assert.equal(cleanResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await cleanResponse.arrayBuffer()).toString(), cleanBody.toString());
  assert.equal((await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_PRIVATE}/${cleanKey}`)).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/v1/files/${cleanId}?download=1`, {
    headers: { authorization: `Bearer ${otherToken}` },
  })).status, 404);
  assert.equal(await core.auditLog.count({ where: { action: 'file.download', targetId: cleanId } }), 1);

  const persisted = await upload(form('survives restart'));
  assert.equal(persisted.status, 202);
  const persistedRow = await core.attachment.findUniqueOrThrow({ where: { id: (await persisted.json()).data.id } });
  execFileSync('docker', ['restart', process.env.NEXORA_TEST_S3_CONTAINER], { stdio: 'ignore' });
  const port = execFileSync('docker', ['port', process.env.NEXORA_TEST_S3_CONTAINER, '8333/tcp'],
    { encoding: 'utf8' }).trim().split(':').at(-1);
  const restoredStore = createS3FileStore({ ...process.env, S3_ENDPOINT: `http://127.0.0.1:${port}` });
  await waitForStorage(restoredStore);
  assert.equal((await restoredStore.get('quarantine', persistedRow.objectKey)).toString(), 'survives restart');
  assert.equal((await core.attachment.findUniqueOrThrow({ where: { id: persistedRow.id } })).sha256Hex,
    persistedRow.sha256Hex);
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createClamAvScanner } from '../../services/core-data/files/clamav.mjs';
import { createS3FileStore } from '../../services/core-data/files/s3-store.mjs';
import { createFileService } from '../../services/core-data/files/upload-service.mjs';
import { handleFileRequest } from '../../services/core-data/files/http.mjs';
import { reconcileFiles } from '../../services/core-data/files/reconcile.mjs';
import { createScanWorker } from '../../services/core-data/files/scan-worker.mjs';

if (process.env.NEXORA_TEST_SCAN !== '1' || !process.env.CORE_DATABASE_URL ||
    !process.env.CLAMAV_PORT) throw new Error('Scan test needs isolated services');
const connect = (url) => new PrismaClient({ datasources: { db: { url } } });
const admin = connect(process.env.DATABASE_URL);
const core = connect(process.env.CORE_DATABASE_URL);
const coreStore = createS3FileStore(process.env);
const scannerStore = createS3FileStore({ ...process.env,
  S3_ACCESS_KEY: process.env.S3_SCANNER_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SCANNER_SECRET_KEY });
const scanner = createClamAvScanner({ host: process.env.CLAMAV_HOST,
  port: Number(process.env.CLAMAV_PORT) });
const worker = createScanWorker(core, scannerStore, scanner);
const files = createFileService(core, coreStore);
const staff = { sub: 'p03-scan-staff', role: 'staff' };
const administrator = { sub: 'p03-scan-admin', role: 'administrator' };
after(async () => { await Promise.all([admin.$disconnect(), core.$disconnect()]); });

async function ready() {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      await scanner.version();
      if (!await coreStore.exists('quarantine', `probe-${randomUUID()}`)) return;
    } catch { /* Services and signature database may still be starting. */ }
    await delay(1000);
  }
  throw new Error('ClamAV or SeaweedFS did not become ready in four minutes');
}

async function upload(text) {
  return files.upload({ actor: staff, body: Buffer.from(text), declaredType: 'text/plain',
    idempotencyKey: randomUUID(), requestId: randomUUID() });
}
async function row(id) { return core.attachment.findUniqueOrThrow({ where: { id } }); }
async function locked(id) {
  await assert.rejects(files.download({ actor: staff, id, requestId: randomUUID() }),
    (error) => error.status === 423);
}

test('real ClamAV scan gates private bytes and records result atomically', async () => {
  await ready();
  const accepted = await upload('clean scan fixture');
  assert.equal(accepted.scanState, 'pending');
  await locked(accepted.id);
  const candidate = await row(accepted.id);
  const outcomes = await Promise.all([worker.scanOne(candidate), worker.scanOne(candidate)]);
  assert.deepEqual(outcomes.sort(), ['clean', 'skipped']);
  const clean = await row(accepted.id);
  assert.equal(clean.scanState, 'clean');
  assert.equal(clean.bucket, 'private');
  assert.equal(clean.scanAttempts, 1);
  assert.match(clean.scanEngineVersion, /^ClamAV [^/]+\/\d+\//);
  assert.ok(clean.scannedAt instanceof Date);
  assert.equal(await coreStore.exists('quarantine', candidate.objectKey), false);
  assert.equal((await files.download({ actor: staff, id: clean.id, requestId: randomUUID() }))
    .body.toString(), 'clean scan fixture');
  assert.equal((await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_PRIVATE}/${clean.objectKey}`)).status, 403);
  await assert.rejects(scannerStore.get('private', clean.objectKey));
  assert.equal(await core.auditLog.count({ where: { targetId: clean.id, action: 'file.scan_clean' } }), 1);
  const orphanKey = `clean/${randomUUID()}`;
  await coreStore.put('private', orphanKey, Buffer.from('orphan clean copy'), 'text/plain', clean.sha256Hex);
  const reconciled = await reconcileFiles(core, coreStore,
    { now: new Date(Date.now() + 20 * 60_000) });
  assert.equal(reconciled.orphanPrivateObjects, 1);
  assert.equal(await coreStore.exists('private', orphanKey), false);
  assert.equal(await coreStore.exists('private', clean.objectKey), true);

  // Assemble the harmless industry test pattern at runtime; no malware sample is stored in Git.
  const testPattern = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');
  const infectedId = (await upload(testPattern)).id;
  assert.equal(await worker.scanOne(await row(infectedId)), 'infected');
  const infected = await row(infectedId);
  assert.equal(infected.scanState, 'infected');
  assert.equal(infected.bucket, 'quarantine');
  assert.ok(infected.scannedAt);
  assert.ok(infected.scanEngineVersion);
  assert.equal(await coreStore.exists('quarantine', infected.objectKey), true);
  await locked(infectedId);
  await assert.rejects(files.retryScan({ actor: administrator, id: infectedId,
    requestId: randomUUID() }), (error) => error.status === 409);
  assert.equal(await core.auditLog.count({ where: { targetId: infectedId, action: 'file.scan_infected' } }), 1);
  await assert.rejects(files.discardInfected({ actor: staff, id: infectedId,
    requestId: randomUUID() }), (error) => error.status === 403);
  assert.deepEqual(await files.discardInfected({ actor: administrator, id: infectedId,
    requestId: randomUUID() }), { id: infectedId, scanState: 'infected', discarded: true });
  assert.equal(await coreStore.exists('quarantine', infected.objectKey), false);
  assert.ok((await row(infectedId)).quarantinePurgedAt);
  await files.discardInfected({ actor: administrator, id: infectedId, requestId: randomUUID() });
  assert.equal(await core.auditLog.count({ where: { targetId: infectedId, action: 'file.scan_discard' } }), 1);
  await locked(infectedId);

  await assert.rejects(files.upload({ actor: staff, body: Buffer.from('not PDF'),
    declaredType: 'application/pdf', idempotencyKey: randomUUID(), requestId: randomUUID() }),
  (error) => error.status === 422);
});

test('scanner down and timeout fail closed with bounded retry and admin intervention', async () => {
  const unavailable = createScanWorker(core, scannerStore,
    createClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 100 }));
  const firstId = (await upload('scanner down fixture')).id;
  assert.equal(await unavailable.scanOne(await row(firstId)), 'error');
  const failed = await row(firstId);
  assert.equal(failed.scanState, 'error');
  assert.equal(failed.scanErrorCode, 'SCANNER_UNAVAILABLE');
  assert.equal(failed.scanAttempts, 1);
  assert.ok(failed.nextScanAt > new Date());
  await locked(firstId);
  assert.equal((await unavailable.runBatch()).error, 0);
  const future = createScanWorker(core, scannerStore, scanner,
    { now: () => new Date(failed.nextScanAt.getTime() + 1) });
  assert.equal((await future.runBatch()).clean, 1);
  assert.equal((await row(firstId)).scanState, 'clean');

  const secondId = (await upload('admin retry fixture')).id;
  assert.equal(await unavailable.scanOne(await row(secondId)), 'error');
  const api = createHttpServer(async (req, res) => {
    await handleFileRequest(req, res, { files, authenticate: async () =>
      req.headers.authorization === 'Bearer admin-test' ? administrator : staff });
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${api.address().port}/api/v1/files/${secondId}/retry-scan`;
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer staff-test' } })).status, 403);
    const retry = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer admin-test' } });
    assert.equal(retry.status, 202);
    assert.deepEqual((await retry.json()).data, { id: secondId, scanState: 'pending' });
  } finally { await new Promise((resolve) => api.close(resolve)); }
  assert.equal(await worker.scanOne(await row(secondId)), 'clean');
  assert.equal(await core.auditLog.count({ where: { targetId: secondId, action: 'file.scan_retry' } }), 1);

  const sockets = new Set();
  const silent = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  try {
    const timeoutWorker = createScanWorker(core, scannerStore, createClamAvScanner({
      host: '127.0.0.1', port: silent.address().port, timeoutMs: 100,
    }));
    const timeoutId = (await upload('scanner timeout fixture')).id;
    assert.equal(await timeoutWorker.scanOne(await row(timeoutId)), 'error');
    assert.equal((await row(timeoutId)).scanErrorCode, 'SCANNER_TIMEOUT');
    await locked(timeoutId);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  }

  const staleServer = createTcpServer((socket) => {
    socket.once('data', () => socket.end('ClamAV 1.4.6/1/Sat Jan 01 00:00:00 2000\0'));
  });
  await new Promise((resolve) => staleServer.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(createClamAvScanner({ host: '127.0.0.1',
      port: staleServer.address().port }).scan(Buffer.from('clean')),
    (error) => error.code === 'SCANNER_SIGNATURE_STALE');
  } finally { await new Promise((resolve) => staleServer.close(resolve)); }

  const corruptId = (await upload('original evidence')).id;
  const corrupt = await row(corruptId);
  await coreStore.putQuarantine(corrupt.objectKey, Buffer.from('tampered evidence'),
    'text/plain', corrupt.sha256Hex);
  assert.equal(await worker.scanOne(corrupt), 'error');
  assert.equal((await row(corruptId)).scanErrorCode, 'FILE_INTEGRITY_ERROR');
  await locked(corruptId);
  assert.equal(await core.auditLog.count({ where: { targetId: corruptId, action: 'file.scan_error' } }), 1);

  const boundedId = (await upload('bounded retries')).id;
  let clock = new Date();
  const bounded = createScanWorker(core, scannerStore,
    createClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 100 }),
    { now: () => clock });
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal((await bounded.runBatch()).error >= 1, true);
    const current = await row(boundedId);
    assert.equal(current.scanAttempts, attempt);
    assert.equal(current.scanState, 'error');
    if (attempt < 5) clock = new Date(current.nextScanAt.getTime() + 1);
    else assert.equal(current.nextScanAt, null);
  }
  assert.equal((await bounded.runBatch()).error, 0);
  await locked(boundedId);

  const strandedId = (await upload('lease exhaustion')).id;
  await core.attachment.update({ where: { id: strandedId }, data: {
    scanAttempts: 5, scanLeaseId: randomUUID(),
    scanLeaseUntil: new Date(Date.now() - 1000),
  } });
  assert.equal((await worker.runBatch()).error >= 1, true);
  const stranded = await row(strandedId);
  assert.equal(stranded.scanState, 'error');
  assert.equal(stranded.nextScanAt, null);
  assert.equal(stranded.scanLeaseId, null);
  await locked(strandedId);
});

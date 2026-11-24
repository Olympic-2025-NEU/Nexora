// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { handlePublicEvidenceRequest } from './public-evidence.mjs';

function sink() {
  return { status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; } };
}

test('P08-T07 preauthorized evidence stream fails closed for unknown or altered bytes', async () => {
  const token = 'a'.repeat(43);
  const bytes = Buffer.from('clean evidence');
  const row = { attachment_id: '11111111-1111-4111-8111-111111111111',
    object_key: 'clean/object', sha256_hex: createHash('sha256').update(bytes).digest('hex'),
    mime_type: 'text/plain', size_bytes: BigInt(bytes.length) };
  let allowed = false;
  const db = { $queryRaw: async () => allowed ? [row] : [] };
  const store = { get: async () => bytes };
  const request = { url: `/public/evidence/${token}`, method: 'GET' };
  const unknown = sink();
  assert.equal(await handlePublicEvidenceRequest(request, unknown, { db, store }), true);
  assert.equal(unknown.status, 404);
  allowed = true;
  const success = sink();
  await handlePublicEvidenceRequest(request, success, { db, store });
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, bytes);
  assert.match(success.headers['cache-control'], /no-store/);
  assert.equal(success.headers['content-security-policy'], 'sandbox');
  const corrupt = sink();
  await handlePublicEvidenceRequest(request, corrupt,
    { db, store: { get: async () => Buffer.from('corrupt') } });
  assert.equal(corrupt.status, 503);
  const invalid = sink();
  await handlePublicEvidenceRequest({ url: '/public/evidence/short', method: 'GET' },
    invalid, { db, store });
  assert.equal(invalid.status, 404);
});

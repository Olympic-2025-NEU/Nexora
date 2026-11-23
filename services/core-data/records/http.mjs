// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { CoreAuthError } from '../auth.mjs';
import { RecordError } from './policy.mjs';

const messages = {
  401: 'Authentication required', 403: 'Forbidden', 404: 'Record not found',
  409: 'Record conflict', 422: 'Invalid record', 503: 'Record service unavailable',
};

function json(res, status, body, requestId, version) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-request-id': requestId, ...(version === undefined ? {} : { etag: `"${version}"` }) });
  res.end(JSON.stringify(body));
}

async function body(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new RecordError('RECORD_CONTENT_TYPE_INVALID');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new RecordError('RECORD_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RecordError('RECORD_JSON_INVALID'); }
}

export async function handleRecordRequest(req, res, { authenticate, records }) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const root = path === '/records' || path === '/records/' || path === '/api/v1/core/records';
  const match = /^\/(?:api\/v1\/core\/)?records\/([0-9a-f-]+)$/i.exec(path);
  if (!root && !match) return false;
  const suppliedId = req.headers['x-request-id'];
  const requestId = typeof suppliedId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : randomUUID();
  try {
    const actor = await authenticate(req);
    if (root && req.method === 'POST') {
      if (new URL(req.url, 'http://localhost').search) throw new RecordError('RECORD_QUERY_INVALID');
      const matchHeader = req.headers['if-match'];
      if (matchHeader !== undefined && (typeof matchHeader !== 'string' || !/^"[1-9][0-9]*"$/.test(matchHeader) ||
          !Number.isSafeInteger(Number(matchHeader.slice(1, -1))))) {
        throw new RecordError('IF_MATCH_INVALID');
      }
      const result = await records.create({ actor, input: await body(req),
        idempotencyKey: req.headers['idempotency-key'],
        ifMatch: matchHeader === undefined ? undefined : Number(matchHeader.slice(1, -1)), requestId });
      json(res, result.status, { data: result.data, requestId }, requestId, result.data.version);
      return true;
    }
    if (match && req.method === 'GET') {
      if (new URL(req.url, 'http://localhost').search) throw new RecordError('RECORD_QUERY_INVALID');
      const data = await records.get({ actor, id: match[1] });
      json(res, 200, { data, requestId }, requestId, data.version);
      return true;
    }
    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', requestId }, requestId);
  } catch (error) {
    const status = error instanceof CoreAuthError || error instanceof RecordError ? error.status : 503;
    const code = error instanceof CoreAuthError || error instanceof RecordError ? error.code : 'RECORD_UNAVAILABLE';
    if (status === 503) console.warn(JSON.stringify({ service: 'core-data', code, requestId }));
    json(res, status, { code, message: messages[status], requestId }, requestId);
  }
  return true;
}

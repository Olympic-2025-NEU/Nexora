// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { CoreAuthError } from '../auth.mjs';
import { FileError } from './file-policy.mjs';
import { parseFileUpload } from './multipart.mjs';

const messages = {
  400: 'Invalid file request', 401: 'Authentication required', 403: 'Forbidden',
  404: 'File not found', 409: 'Idempotency conflict', 422: 'Invalid file',
  423: 'File has not passed scanning', 503: 'File service unavailable',
};

function json(res, status, body, requestId) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-request-id': requestId });
  res.end(JSON.stringify(body));
}

export async function handleFileRequest(req, res, { authenticate, files }) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const root = path === '/files' || path === '/files/' || path === '/api/v1/files';
  const match = /^\/(?:api\/v1\/)?files\/([0-9a-f-]+)$/i.exec(path);
  const retry = /^\/(?:api\/v1\/)?files\/([0-9a-f-]+)\/retry-scan$/i.exec(path);
  const discard = /^\/(?:api\/v1\/)?files\/([0-9a-f-]+)\/discard$/i.exec(path);
  if (!root && !match && !retry && !discard) return false;
  const suppliedId = req.headers['x-request-id'];
  const requestId = typeof suppliedId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : randomUUID();
  try {
    const actor = await authenticate(req);
    if (root && req.method === 'POST') {
      const upload = await parseFileUpload(req);
      const data = await files.upload({ actor, ...upload,
        idempotencyKey: req.headers['idempotency-key'], requestId });
      json(res, 202, { data, requestId }, requestId);
      return true;
    }
    if ((retry || discard) && req.method === 'POST') {
      if ((req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') ||
          req.headers['transfer-encoding']) {
        throw new FileError('FILE_REQUEST_INVALID', 400);
      }
      const data = retry ? await files.retryScan({ actor, id: retry[1], requestId })
        : await files.discardInfected({ actor, id: discard[1], requestId });
      json(res, 202, { data, requestId }, requestId);
      return true;
    }
    if (match && req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      if ([...url.searchParams.keys()].some((name) => name !== 'download') ||
          url.searchParams.getAll('download').length > 1 ||
          (url.searchParams.has('download') && url.searchParams.get('download') !== '1')) {
        throw new FileError('FILE_QUERY_INVALID', 400);
      }
      if (url.searchParams.has('download')) {
        const file = await files.download({ actor, id: match[1], requestId });
        res.writeHead(200, { 'content-type': file.mimeType, 'content-length': file.body.length,
          'content-disposition': `attachment; filename="attachment-${match[1]}"`,
          'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox',
          'cache-control': 'no-store', 'x-request-id': requestId });
        res.end(file.body);
        return true;
      }
      const data = await files.metadata({ actor, id: match[1] });
      json(res, 200, { data, requestId }, requestId);
      return true;
    }
    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', requestId }, requestId);
  } catch (error) {
    const status = error instanceof FileError || error instanceof CoreAuthError ? error.status : 503;
    const code = error instanceof FileError || error instanceof CoreAuthError ? error.code : 'FILE_UNAVAILABLE';
    if (status === 503) console.warn(JSON.stringify({ service: 'core-data', code, requestId }));
    json(res, status, { code, message: messages[status], requestId }, requestId);
  }
  return true;
}

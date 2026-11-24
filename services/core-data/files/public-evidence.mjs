// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';

const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const responseHeaders = { 'cache-control': 'private, no-store, max-age=0',
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow' };

/** Short-lived application-signed capability; the filtered DB view rechecks policy at download. */
export async function handlePublicEvidenceRequest(req, res, { db, store }) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const match = /^\/(?:api\/v1\/)?public\/evidence\/([^/]+)$/.exec(path);
  if (!match) return false;
  const requestId = randomUUID();
  const fail = (status) => {
    res.writeHead(status, { ...responseHeaders, 'content-type': 'application/json',
      'x-request-id': requestId });
    res.end(JSON.stringify({ error: status === 404 ? 'NOT_FOUND' :
      status === 405 ? 'METHOD_NOT_ALLOWED' : 'SERVICE_UNAVAILABLE' }));
  };
  if (!['GET', 'HEAD'].includes(req.method)) { fail(405); return true; }
  if (!tokenFormat.test(match[1])) { fail(404); return true; }
  try {
    const rows = await db.$queryRaw`
      SELECT attachment_id, object_key, sha256_hex, mime_type, size_bytes
      FROM traceability.public_evidence_download WHERE token_hash = ${sha(match[1])}
      LIMIT 1`;
    const row = rows[0];
    if (!row) { fail(404); return true; }
    const body = req.method === 'HEAD' ? null : await store.get('private', row.object_key);
    if (body && (body.length !== Number(row.size_bytes) || sha(body) !== row.sha256_hex)) {
      fail(503); return true;
    }
    res.writeHead(200, { ...responseHeaders, 'content-type': row.mime_type,
      'content-length': Number(row.size_bytes), 'content-security-policy': 'sandbox',
      'content-disposition': `attachment; filename="evidence-${row.attachment_id}"`,
      'x-request-id': requestId });
    res.end(body);
  } catch {
    fail(503);
  }
  return true;
}

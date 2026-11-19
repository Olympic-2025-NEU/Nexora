// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { recordCoreAudit } from '../audit.mjs';
import { FileError, validateFile, validateIdempotencyKey, validateUploadFields } from './file-policy.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function metadata(row) {
  return { id: row.id, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes),
    scanState: row.scanState, visibility: row.visibility, checksum: row.sha256Hex };
}

async function authorizedRow(db, actor, id) {
  if (!uuid.test(id)) throw new FileError('FILE_ID_INVALID', 400);
  const row = await db.attachment.findUnique({ where: { id } });
  if (!row || (actor.role !== 'administrator' && row.createdBySub !== actor.sub)) {
    throw new FileError('FILE_NOT_FOUND', 404);
  }
  return row;
}

export function createFileService(db, store) {
  return {
    async upload({ actor, body, declaredType, fields = {}, idempotencyKey, requestId }) {
      if (!['administrator', 'staff'].includes(actor.role)) throw new FileError('POLICY_DENIED', 403);
      validateUploadFields(fields);
      const key = validateIdempotencyKey(idempotencyKey);
      const file = validateFile(body, declaredType);
      const uploadKeyHash = hash(JSON.stringify(['POST', '/api/v1/files', actor.sub, key]));
      const uploadPayloadHash = hash(JSON.stringify([file.sha256Hex, file.mimeType, file.sizeBytes]));
      const replay = await db.attachment.findUnique({ where: { uploadKeyHash } });
      if (replay) {
        if (replay.uploadPayloadHash !== uploadPayloadHash) throw new FileError('IDEMPOTENCY_CONFLICT', 409);
        return { id: replay.id, scanState: 'pending' };
      }
      const id = randomUUID();
      const objectKey = `pending/${randomUUID()}`;
      await store.putQuarantine(objectKey, body, file.mimeType, file.sha256Hex);
      try {
        await db.$transaction(async (tx) => {
          await tx.attachment.create({ data: {
            id, ownerType: 'core_record', ownerId: null, bucket: 'quarantine', objectKey,
            sha256Hex: file.sha256Hex, mimeType: file.mimeType,
            sizeBytes: BigInt(file.sizeBytes), scanState: 'pending', visibility: 'private',
            createdBySub: actor.sub, uploadKeyHash, uploadPayloadHash,
          } });
          await recordCoreAudit(tx, { actorSub: actor.sub, action: 'file.upload',
            targetType: 'attachment', targetId: id, requestId,
            afterSummary: { scanState: 'pending', visibility: 'private' } });
        });
      } catch (error) {
        try { await store.delete('quarantine', objectKey); }
        catch { console.warn(JSON.stringify({ service: 'core-data', code: 'FILE_COMPENSATION_FAILED', requestId })); }
        const winner = await db.attachment.findUnique({ where: { uploadKeyHash } });
        if (winner) {
          if (winner.uploadPayloadHash !== uploadPayloadHash) throw new FileError('IDEMPOTENCY_CONFLICT', 409);
          return { id: winner.id, scanState: 'pending' };
        }
        throw error;
      }
      return { id, scanState: 'pending' };
    },
    async metadata({ actor, id }) {
      return metadata(await authorizedRow(db, actor, id));
    },
    async download({ actor, id, requestId }) {
      const row = await authorizedRow(db, actor, id);
      if (row.scanState !== 'clean' || row.bucket !== 'private' || row.visibility !== 'private') {
        throw new FileError('FILE_NOT_CLEAN', 423);
      }
      const body = await store.get('private', row.objectKey);
      if (body.length !== Number(row.sizeBytes) || hash(body) !== row.sha256Hex) {
        throw new FileError('FILE_CHECKSUM_MISMATCH', 503);
      }
      await recordCoreAudit(db, { actorSub: actor.sub, action: 'file.download',
        targetType: 'attachment', targetId: id, requestId,
        afterSummary: { scanState: 'clean' } });
      return { body, mimeType: row.mimeType };
    },
  };
}

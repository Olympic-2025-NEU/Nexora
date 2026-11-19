// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { recordCoreAudit } from '../audit.mjs';
import { coreRecordRepository, evidenceAccessRepository } from '../repositories.mjs';
import { authorizeEvidence, authorizeKind, RecordError, uuid } from './policy.mjs';
import { validateRecord } from './schema.mjs';

function sourceIdFor(sub, key) {
  // Deterministic server-issued UUID: retry survives lost response without another table.
  const bytes = createHash('sha256').update(JSON.stringify([sub, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function view(row) {
  return { id: row.id, kind: row.kind, version: row.version, checksum: row.checksumHex,
    builtAt: row.builtAt.toISOString(), visibility: row.visibility, payload: row.payload };
}

export function createRecordService(db) {
  async function visible(actor, row, access) {
    if (!row || row.kind !== 'evidence_metadata' || row.visibility !== 'private' ||
        row.policyVersion !== 'v1') {
      throw new RecordError('RECORD_NOT_FOUND', 404);
    }
    authorizeKind(actor, row.kind, 'read');
    try { validateRecord({ kind: row.kind, payload: row.payload }); }
    catch (error) {
      if (error instanceof RecordError) throw new RecordError('RECORD_NOT_FOUND', 404);
      throw error;
    }
    await authorizeEvidence(access, actor, row.payload, 'read');
    return view(row);
  }

  return {
    async create({ actor, input, idempotencyKey, ifMatch, requestId }) {
      validateRecord(input);
      authorizeKind(actor, input.kind, 'create');
      if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
        throw new RecordError('IDEMPOTENCY_KEY_INVALID');
      }
      const sourceId = sourceIdFor(actor.sub, idempotencyKey);
      const checksumHex = createHash('sha256').update(canonicalize(input.payload), 'utf8').digest('hex');
      const existingResult = async (row, access) => {
        await visible(actor, row, access);
        if (ifMatch !== undefined && ifMatch !== row.version) throw new RecordError('VERSION_CONFLICT', 409);
        if (row.checksumHex !== checksumHex) throw new RecordError('IDEMPOTENCY_CONFLICT', 409);
        return { status: 200, data: view(row) };
      };
      try {
        return await db.$transaction(async (tx) => {
          const records = coreRecordRepository(tx);
          const access = evidenceAccessRepository(tx);
          await authorizeEvidence(access, actor, input.payload, 'create');
          const previous = await records.findBySource(input.kind, 'evidence', sourceId);
          if (previous) {
            if (previous.checksumHex === checksumHex || ifMatch === undefined) {
              return existingResult(previous, access);
            }
            await visible(actor, previous, access);
            authorizeKind(actor, input.kind, 'update');
            if (ifMatch !== previous.version) throw new RecordError('VERSION_CONFLICT', 409);
            if (previous.payload.ownerType !== input.payload.ownerType ||
                previous.payload.ownerId !== input.payload.ownerId) {
              throw new RecordError('OWNER_CHANGE_DENIED', 403);
            }
            const updated = await records.replaceIfVersion(previous.id, ifMatch,
              { payload: input.payload, checksumHex, builtAt: new Date() });
            if (!updated) throw new RecordError('VERSION_CONFLICT', 409);
            await recordCoreAudit(tx, { actorSub: actor.sub, action: 'core_record.update',
              targetType: 'core_record', targetId: updated.id, requestId,
              afterSummary: { kind: updated.kind, version: updated.version } });
            return { status: 200, data: view(updated) };
          }
          if (ifMatch !== undefined) throw new RecordError('VERSION_CONFLICT', 409);
          const row = await records.create({ id: randomUUID(), kind: input.kind,
            sourceType: 'evidence', sourceId, payload: input.payload, visibility: 'private',
            policyVersion: 'v1', checksumHex, builtAt: new Date() });
          await recordCoreAudit(tx, { actorSub: actor.sub, action: 'core_record.create',
            targetType: 'core_record', targetId: row.id, requestId,
            afterSummary: { kind: row.kind, version: row.version } });
          return { status: 201, data: view(row) };
        });
      } catch (error) {
        if (error.code !== 'P2002') throw error;
        const winner = await coreRecordRepository(db).findBySource(input.kind, 'evidence', sourceId);
        if (!winner) throw error;
        return existingResult(winner, evidenceAccessRepository(db));
      }
    },
    async get({ actor, id }) {
      if (!uuid.test(id)) throw new RecordError('RECORD_ID_INVALID');
      const row = await coreRecordRepository(db).findById(id);
      return visible(actor, row, evidenceAccessRepository(db));
    },
  };
}

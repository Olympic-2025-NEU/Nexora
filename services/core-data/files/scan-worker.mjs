// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { recordCoreAudit } from '../audit.mjs';
import { ScannerError } from './clamav.mjs';

const MAX_ATTEMPTS = 5;
const hash = (body) => createHash('sha256').update(body).digest('hex');
const retryMs = (attempt) => Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1));

export function createScanWorker(db, store, scanner, { now = () => new Date() } = {}) {
  async function claim(row) {
    const leaseId = randomUUID();
    const time = now();
    const claimed = await db.attachment.updateMany({ where: {
      id: row.id, version: row.version, bucket: 'quarantine',
      scanState: row.scanState, scanAttempts: { lt: MAX_ATTEMPTS },
      OR: [{ scanLeaseUntil: null }, { scanLeaseUntil: { lte: time } }],
    }, data: { scanState: 'pending', scanAttempts: { increment: 1 },
      scanErrorCode: null, nextScanAt: null, scanLeaseId: leaseId,
      scanLeaseUntil: new Date(time.getTime() + 60_000),
      version: { increment: 1 }, updatedAt: time } });
    return claimed.count === 1 ? { ...row, scanAttempts: row.scanAttempts + 1,
      version: row.version + 1, scanLeaseId: leaseId } : null;
  }

  async function finish(row, state, details = {}) {
    const time = now();
    return db.$transaction(async (tx) => {
      const updated = await tx.attachment.updateMany({ where: {
        id: row.id, version: row.version, scanLeaseId: row.scanLeaseId,
        bucket: 'quarantine', scanState: 'pending',
      }, data: { scanState: state, scanLeaseId: null, scanLeaseUntil: null,
        version: { increment: 1 }, updatedAt: time, ...details } });
      if (updated.count !== 1) return false;
      await recordCoreAudit(tx, { clientId: 'core-file-scanner',
        action: `file.scan_${state}`, targetType: 'attachment', targetId: row.id,
        requestId: randomUUID(), afterSummary: { scanState: state,
          ...(state === 'error' ? { scanErrorCode: details.scanErrorCode } : {}) } });
      return true;
    });
  }

  async function scanOne(candidate) {
    const row = await claim(candidate);
    if (!row) return 'skipped';
    let promotedKey;
    try {
      let body;
      try { body = await store.get('quarantine', row.objectKey); }
      catch { throw new ScannerError('FILE_STORAGE_ERROR'); }
      if (body.length !== Number(row.sizeBytes) || hash(body) !== row.sha256Hex) {
        throw new ScannerError('FILE_INTEGRITY_ERROR');
      }
      const verdict = await scanner.scan(body);
      if (verdict.outcome === 'clean') {
        promotedKey = `clean/${randomUUID()}`;
        try { await store.put('private', promotedKey, body, row.mimeType, row.sha256Hex); }
        catch { throw new ScannerError('FILE_STORAGE_ERROR'); }
        const changed = await finish(row, 'clean', { bucket: 'private', objectKey: promotedKey,
          scannedAt: verdict.scannedAt, scanEngineVersion: verdict.engineVersion,
          scanErrorCode: null, nextScanAt: null });
        if (!changed) {
          await store.delete('private', promotedKey);
          promotedKey = undefined;
          return 'skipped';
        }
        promotedKey = undefined;
        try { await store.delete('quarantine', row.objectKey); }
        catch { console.warn(JSON.stringify({ service: 'core-file-scanner', code: 'QUARANTINE_CLEANUP_FAILED', fileId: row.id })); }
        return 'clean';
      }
      if (verdict.outcome !== 'infected') throw new ScannerError('SCANNER_PROTOCOL');
      const changed = await finish(row, 'infected', { scannedAt: verdict.scannedAt,
        scanEngineVersion: verdict.engineVersion, scanErrorCode: null, nextScanAt: null });
      return changed ? 'infected' : 'skipped';
    } catch (error) {
      if (promotedKey) {
        try { await store.delete('private', promotedKey); }
        catch { console.warn(JSON.stringify({ service: 'core-file-scanner', code: 'PRIVATE_COMPENSATION_FAILED', fileId: row.id })); }
      }
      const code = error instanceof ScannerError ? error.code : 'SCANNER_PROTOCOL';
      const nextScanAt = row.scanAttempts < MAX_ATTEMPTS
        ? new Date(now().getTime() + retryMs(row.scanAttempts)) : null;
      return await finish(row, 'error', { scanErrorCode: code, nextScanAt }) ? 'error' : 'skipped';
    }
  }

  return {
    scanOne,
    async runBatch(limit = 20) {
      const time = now();
      const counts = { clean: 0, infected: 0, error: 0, skipped: 0 };
      const stranded = await db.attachment.findMany({ where: {
        bucket: 'quarantine', scanState: 'pending', scanAttempts: MAX_ATTEMPTS,
        scanLeaseUntil: { lte: time },
      }, take: 100, orderBy: { createdAt: 'asc' } });
      for (const row of stranded) {
        if (await finish(row, 'error', { scanErrorCode: 'SCANNER_UNAVAILABLE', nextScanAt: null })) counts.error++;
      }
      const rows = await db.attachment.findMany({ where: {
        bucket: 'quarantine', scanAttempts: { lt: MAX_ATTEMPTS },
        OR: [{ scanState: 'pending' }, { scanState: 'error', nextScanAt: { lte: time } }],
        AND: [{ OR: [{ scanLeaseUntil: null }, { scanLeaseUntil: { lte: time } }] }],
      }, orderBy: { createdAt: 'asc' }, take: Math.min(Math.max(limit, 1), 100) });
      for (const row of rows) counts[await scanOne(row)]++;
      return counts;
    },
  };
}

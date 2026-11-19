// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { recordCoreAudit } from '../audit.mjs';

/** Repeated runs are safe; the grace period protects uploads still in flight. */
export async function reconcileFiles(db, store, { now = new Date(), graceMs = 15 * 60_000 } = {}) {
  const cutoff = new Date(now.getTime() - graceMs);
  let orphanObjects = 0;
  let missingObjects = 0;
  for await (const object of store.listQuarantine()) {
    if (object.lastModified >= cutoff) continue;
    const row = await db.attachment.findUnique({
      where: { bucket_objectKey: { bucket: 'quarantine', objectKey: object.key } },
    });
    if (!row) {
      await store.delete('quarantine', object.key);
      orphanObjects++;
    }
  }
  const pending = await db.attachment.findMany({ where: {
    bucket: 'quarantine', scanState: 'pending', createdAt: { lt: cutoff },
  }, take: 500, orderBy: { createdAt: 'asc' } });
  for (const row of pending) {
    if (await store.exists('quarantine', row.objectKey)) continue;
    await db.$transaction(async (tx) => {
      const result = await tx.attachment.updateMany({ where: {
        id: row.id, version: row.version, bucket: 'quarantine', scanState: 'pending',
      }, data: { scanState: 'error', version: { increment: 1 }, updatedAt: new Date() } });
      if (result.count !== 1) return;
      await recordCoreAudit(tx, { clientId: 'core-file-reconciler', action: 'file.storage_missing',
        targetType: 'attachment', targetId: row.id, requestId: randomUUID(),
        afterSummary: { scanState: 'error' } });
      missingObjects++;
    });
  }
  return { orphanObjects, missingObjects };
}

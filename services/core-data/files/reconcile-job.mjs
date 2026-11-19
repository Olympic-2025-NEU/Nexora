// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { createS3FileStore } from './s3-store.mjs';
import { reconcileFiles } from './reconcile.mjs';

if (!process.env.CORE_DATABASE_URL) throw new Error('Missing CORE_DATABASE_URL');
const db = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
const store = createS3FileStore(process.env);
while (true) {
  try {
    const result = await reconcileFiles(db, store);
    console.info(JSON.stringify({ service: 'core-file-reconciler', outcome: 'success', ...result }));
  } catch {
    console.warn(JSON.stringify({ service: 'core-file-reconciler', outcome: 'failure', code: 'RECONCILE_FAILED' }));
  }
  await delay(15 * 60_000);
}

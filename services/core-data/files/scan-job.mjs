// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { createClamAvScanner } from './clamav.mjs';
import { createS3FileStore } from './s3-store.mjs';
import { createScanWorker } from './scan-worker.mjs';

if (!process.env.CORE_DATABASE_URL) throw new Error('Missing CORE_DATABASE_URL');
const db = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
const store = createS3FileStore({ ...process.env,
  S3_ACCESS_KEY: process.env.S3_SCANNER_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SCANNER_SECRET_KEY });
const scanner = createClamAvScanner({ host: process.env.CLAMAV_HOST || 'clamav',
  port: Number(process.env.CLAMAV_PORT || 3310) });
const worker = createScanWorker(db, store, scanner);
while (true) {
  try {
    const result = await worker.runBatch();
    if (Object.values(result).some(Boolean)) console.info(JSON.stringify({ service: 'core-file-scanner', ...result }));
  } catch {
    console.warn(JSON.stringify({ service: 'core-file-scanner', code: 'SCAN_BATCH_FAILED' }));
  }
  await delay(5000);
}

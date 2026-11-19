// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export async function verify(directory, checkToc = true) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.source?.project || !manifest.source?.instance ||
      !manifest.databases || !manifest.roles || !manifest.buckets || !manifest.files ||
      !Array.isArray(manifest.objects) || !Array.isArray(manifest.attachments)) throw new Error('Invalid manifest version or shape');
  const files = new Set(Object.keys(manifest.files));
  const actual = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) actual.push(relative(root, path));
      else throw new Error('Backup contains non-regular file');
    }
  }
  await walk(root);
  if (actual.length !== files.size + 1 || actual.some(name => name !== 'manifest.json' && !files.has(name)))
    throw new Error('Unexpected or missing backup file');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!name || isAbsolute(name) || name.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(expected.sha256) ||
        !Number.isSafeInteger(expected.size) || expected.size < 0) throw new Error('Invalid file manifest');
    const path = join(root, name);
    if (!(await lstat(path)).isFile()) throw new Error('Invalid file type');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== expected.sha256 || (await stat(path)).size !== expected.size)
      throw new Error(`Corrupt backup file: ${name}`);
  }
  const index = new Map();
  for (const object of manifest.objects) {
    const id = `${object.bucket}\0${object.key}`;
    if (!['private', 'quarantine', 'public'].includes(object.bucket) || typeof object.key !== 'string' ||
        index.has(id) || !files.has(object.file) || !object.file.startsWith(`objects/${object.bucket}/`) ||
        object.sha256 !== manifest.files[object.file].sha256 || object.size !== manifest.files[object.file].size)
      throw new Error('Invalid object manifest');
    index.set(id, object);
  }
  if ([...files].filter(name => name.startsWith('objects/')).length !== index.size) throw new Error('Unlisted object file');
  const saved = (await readFile(join(root, 'attachments.jsonl'), 'utf8')).trim().split('\n')
    .filter(Boolean).map(line => JSON.parse(line));
  if (JSON.stringify(saved) !== JSON.stringify(manifest.attachments)) throw new Error('Attachment manifest mismatch');
  if (manifest.counts?.app?.['platform.attachment'] !== saved.length) throw new Error('Attachment count mismatch');
  const definitions = (await readFile(join(root, 'process-definitions.jsonl'), 'utf8')).trim()
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (JSON.stringify(definitions) !== JSON.stringify(manifest.processDefinitions)) throw new Error('Process definition mismatch');
  const purged = [];
  for (const attachment of saved) {
    const object = index.get(`${attachment.bucket}\0${attachment.object_key}`);
    if (!object && attachment.bucket === 'quarantine' && attachment.quarantine_purged_at) {
      purged.push({ id: attachment.id, bucket: attachment.bucket, key: attachment.object_key,
        purgedAt: attachment.quarantine_purged_at });
    } else if (!object || object.sha256 !== attachment.sha256_hex.trim() ||
               String(object.size) !== attachment.size_bytes) throw new Error(`Missing attachment: ${attachment.id}`);
  }
  if (JSON.stringify(purged) !== JSON.stringify(manifest.purged)) throw new Error('Purged attachment mismatch');
  const referenced = new Set(saved.map(a => `${a.bucket}\0${a.object_key}`));
  const orphans = manifest.objects.filter(o => !referenced.has(`${o.bucket}\0${o.key}`))
    .map(o => ({ bucket: o.bucket, key: o.key }));
  if (JSON.stringify(orphans) !== JSON.stringify(manifest.orphanObjects)) throw new Error('Orphan object mismatch');
  for (const label of ['app', 'keycloak', 'flowable']) {
    if (!manifest.databases[label] || !files.has(`${label}.dump`) || !files.has(`${label}.counts`))
      throw new Error('Missing database dump');
    if (checkToc) execFileSync('docker', ['run', '--rm', '--security-opt', 'label=disable', '-v', `${root}:/backup:ro`,
      'postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929',
      'pg_restore', '-l', `/backup/${label}.dump`], { stdio: 'pipe' });
    const rows = Object.fromEntries((await readFile(join(root, `${label}.counts`), 'utf8')).trim().split('\n')
      .filter(Boolean).map(line => { const at = line.lastIndexOf('|'); return [line.slice(0, at), Number(line.slice(at + 1))]; }));
    if (JSON.stringify(rows) !== JSON.stringify(manifest.counts?.[label])) throw new Error('Row count mismatch');
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  try {
    const manifest = await verify(process.argv[2], process.argv[3] !== '--import');
    if (process.argv[3] === '--import') {
      const buckets = Object.fromEntries(['private', 'quarantine', 'public'].map(kind =>
        [kind, process.env[`S3_BUCKET_${kind.toUpperCase()}`]]));
      if (Object.values(buckets).some(value => !value) || new Set(Object.values(buckets)).size !== 3)
        throw new Error('Invalid target buckets');
      const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'us-east-1',
        forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ADMIN_ACCESS_KEY,
          secretAccessKey: process.env.S3_ADMIN_SECRET_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED' });
      for (const bucket of Object.values(buckets)) {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
        if (page.Contents?.length) throw new Error('Target bucket is not empty');
      }
      for (const object of manifest.objects) {
        await client.send(new PutObjectCommand({ Bucket: buckets[object.bucket], Key: object.key,
          Body: createReadStream(join(resolve(process.argv[2]), object.file)), ContentLength: object.size }));
        const stored = await client.send(new GetObjectCommand({ Bucket: buckets[object.bucket], Key: object.key }));
        if (!stored.Body || stored.ContentLength !== object.size) throw new Error('Restored object size differs');
        const hash = createHash('sha256');
        for await (const chunk of stored.Body) hash.update(chunk);
        if (hash.digest('hex') !== object.sha256)
          throw new Error(`Restored object differs: ${object.bucket}/${object.key}`);
      }
      console.log(`Imported and checked ${manifest.objects.length} objects`);
    } else console.log('Backup checksums, TOCs and attachment mapping verified');
  } catch (error) {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

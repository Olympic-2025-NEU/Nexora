// SPDX-License-Identifier: AGPL-3.0-only
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';

const directory = process.argv[2];
const instance = process.argv[3];
if (!directory || (!instance && directory !== '--preflight')) throw new Error('Usage: backup-objects.mjs /backup instance');
const kinds = ['private', 'quarantine', 'public'];
const buckets = Object.fromEntries(kinds.map(kind => [kind, process.env[`S3_BUCKET_${kind.toUpperCase()}`]]));
if (Object.values(buckets).some(value => !value) || new Set(Object.values(buckets)).size !== 3) throw new Error('Invalid bucket mapping');
const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ADMIN_ACCESS_KEY,
    secretAccessKey: process.env.S3_ADMIN_SECRET_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED' });
if (directory === '--preflight') {
  for (const bucket of Object.values(buckets)) await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  process.exit(0);
}
const hashFile = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { sha256: hash.digest('hex'), size: (await stat(file)).size };
};
const objects = [];
for (const kind of kinds) {
  let continuation;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: buckets[kind], ContinuationToken: continuation }));
    for (const item of page.Contents ?? []) {
      if (typeof item.Key !== 'string') throw new Error('Invalid S3 key');
      const name = `objects/${kind}/${objects.length}`;
      const file = join(directory, name);
      await mkdir(join(directory, 'objects', kind), { recursive: true, mode: 0o700 });
      const body = await client.send(new GetObjectCommand({ Bucket: buckets[kind], Key: item.Key }));
      if (!body.Body) throw new Error('Missing S3 body');
      await pipeline(body.Body, createWriteStream(file, { mode: 0o600, flags: 'wx' }));
      const digest = await hashFile(file);
      if (item.Size !== digest.size || body.ContentLength !== digest.size) throw new Error('Object changed during export');
      objects.push({ bucket: kind, key: item.Key, file: name, ...digest });
    }
    continuation = page.NextContinuationToken;
  } while (continuation);
}
const attachments = (await readFile(join(directory, 'attachments.jsonl'), 'utf8')).trim().split('\n')
  .filter(Boolean).map(line => JSON.parse(line));
const index = new Map(objects.map(object => [`${object.bucket}\0${object.key}`, object]));
const purged = [];
for (const attachment of attachments) {
  const object = index.get(`${attachment.bucket}\0${attachment.object_key}`);
  if (!object && attachment.quarantine_purged_at && attachment.bucket === 'quarantine') {
    purged.push({ id: attachment.id, bucket: attachment.bucket, key: attachment.object_key,
      purgedAt: attachment.quarantine_purged_at });
    continue;
  }
  if (!object || object.sha256 !== attachment.sha256_hex.trim() || String(object.size) !== attachment.size_bytes)
    throw new Error(`Attachment missing or mismatched: ${attachment.id}`);
}
const referenced = new Set(attachments.map(a => `${a.bucket}\0${a.object_key}`));
const orphanObjects = objects.filter(o => !referenced.has(`${o.bucket}\0${o.key}`)).map(o => ({ bucket: o.bucket, key: o.key }));
const files = {};
for (const name of ['app.dump', 'keycloak.dump', 'flowable.dump', 'app.counts', 'keycloak.counts',
  'flowable.counts', 'attachments.jsonl', 'process-definitions.jsonl', ...objects.map(o => o.file)]) files[name] = await hashFile(join(directory, name));
const configFiles = ['deploy/compose.yml', 'deploy/apisix/config.yaml', 'deploy/apisix/routes.yaml',
  'deploy/keycloak/realm-template.json', 'deploy/seaweedfs/bucket-policy.json'];
for (const name of await readdir('deploy/flowable/processes')) {
  if (name.endsWith('.bpmn')) configFiles.push(`deploy/flowable/processes/${name}`);
}
const config = Object.fromEntries(await Promise.all(configFiles.map(async name => [name, (await hashFile(resolve(name))).sha256])));
const counts = Object.fromEntries(await Promise.all(['app', 'keycloak', 'flowable'].map(async label => [label,
  Object.fromEntries((await readFile(join(directory, `${label}.counts`), 'utf8')).trim().split('\n')
    .filter(Boolean).map(line => { const at = line.lastIndexOf('|'); return [line.slice(0, at), Number(line.slice(at + 1))]; }))])));
const manifest = { version: 1, source: { instance, project: process.env.BACKUP_PROJECT,
  commit: process.env.BACKUP_COMMIT },
  startedAt: process.env.BACKUP_STARTED, finishedAt: new Date().toISOString(),
  databases: Object.fromEntries(['app', 'keycloak', 'flowable'].map(label => [label, process.env[{
    app: 'APP_DB_NAME', keycloak: 'KEYCLOAK_DB_NAME', flowable: 'FLOWABLE_DB_NAME' }[label]]])),
  roles: Object.fromEntries(['POSTGRES_USER', 'APP_DB_USER', 'CORE_DB_USER', 'MIGRATOR_DB_USER',
    'KEYCLOAK_DB_USER', 'FLOWABLE_DB_USER'].map(name => [name, process.env[name]])),
  buckets, files, objects, attachments, purged, orphanObjects, counts, config,
  processDefinitions: (await readFile(join(directory, 'process-definitions.jsonl'), 'utf8')).trim()
    .split('\n').filter(Boolean).map(line => JSON.parse(line)),
  secretReferences: ['FLOWABLE_AUTH_REF', 'S3_SECRET_REF', 'PARTNER_OUTBOUND_SECRET_REF',
    'env:OIDC_GATEWAY_CLIENT_SECRET'], processState: 'N/A' };
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Exported ${objects.length} objects; ${purged.length} purged attachments; ${orphanObjects.length} orphan objects`);

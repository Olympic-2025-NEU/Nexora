// SPDX-License-Identifier: AGPL-3.0-only
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
const buckets = Object.fromEntries(['private', 'quarantine', 'public'].map((kind) => [kind, required(`S3_BUCKET_${kind.toUpperCase()}`)]));
if (new Set(Object.values(buckets)).size !== 3) throw new Error('S3 bucket names must be unique');
const policy = JSON.parse(readFileSync('/bootstrap/bucket-policy.json', 'utf8'));
const identities = Object.entries(policy).map(([name, actions]) => ({
  name,
  credentials: [{ accessKey: required(`S3_${name.toUpperCase()}_ACCESS_KEY`), secretKey: required(`S3_${name.toUpperCase()}_SECRET_KEY`) }],
  actions: actions.map((action) => {
    const [verb, bucket] = action.split(':');
    return bucket ? `${verb}:${buckets[bucket]}` : verb;
  }),
}));
if (new Set(identities.map((identity) => identity.credentials[0].accessKey)).size !== identities.length) {
  throw new Error('S3 consumer access keys must be unique');
}
writeFileSync('/config/s3.json', JSON.stringify({ identities }), { mode: 0o644 });
chmodSync('/config/s3.json', 0o644);
console.log('SeaweedFS: per-consumer S3 config ready');

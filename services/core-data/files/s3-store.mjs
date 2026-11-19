// SPDX-License-Identifier: AGPL-3.0-only
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { FileError, MAX_FILE_BYTES } from './file-policy.mjs';

const logicalBuckets = ['quarantine', 'private', 'public'];

export function createS3FileStore(env, client) {
  const buckets = Object.fromEntries(logicalBuckets.map((name) =>
    [name, env[`S3_BUCKET_${name.toUpperCase()}`]]));
  if (Object.values(buckets).some((value) => !value) ||
      new Set(Object.values(buckets)).size !== logicalBuckets.length) {
    throw new Error('Invalid S3 bucket configuration');
  }
  const s3 = client ?? new S3Client({
    endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const bucket = (kind) => {
    if (!buckets[kind]) throw new Error('Invalid S3 bucket kind');
    return buckets[kind];
  };
  return {
    buckets,
    async put(kind, key, body, mimeType, sha256Hex) {
      await s3.send(new PutObjectCommand({ Bucket: bucket(kind), Key: key,
        Body: body, ContentLength: body.length, ContentType: mimeType,
        Metadata: { sha256: sha256Hex } }), { abortSignal: AbortSignal.timeout(10000) });
    },
    putQuarantine(key, body, mimeType, sha256Hex) {
      return this.put('quarantine', key, body, mimeType, sha256Hex);
    },
    async get(kind, key) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket(kind), Key: key }),
        { abortSignal: AbortSignal.timeout(10000) });
      if (object.ContentLength > MAX_FILE_BYTES || !object.Body) throw new FileError('FILE_STORAGE_INVALID', 503);
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.length > MAX_FILE_BYTES) throw new FileError('FILE_STORAGE_INVALID', 503);
      return bytes;
    },
    async exists(kind, key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket(kind), Key: key }),
          { abortSignal: AbortSignal.timeout(10000) });
        return true;
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 404) return false;
        throw error;
      }
    },
    async delete(kind, key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket(kind), Key: key }),
        { abortSignal: AbortSignal.timeout(10000) });
    },
    async *list(kind, prefix) {
      let continuation;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket(kind),
          Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuation }),
          { abortSignal: AbortSignal.timeout(10000) });
        for (const object of page.Contents ?? []) {
          if (object.Key && object.LastModified) yield { key: object.Key, lastModified: object.LastModified };
        }
        continuation = page.NextContinuationToken;
      } while (continuation);
    },
    listQuarantine() { return this.list('quarantine', 'pending/'); },
    listPrivate() { return this.list('private', 'clean/'); },
  };
}

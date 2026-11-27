// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Query and verify private archived events from inside an ERP/worker container.
 * Usage: docker exec nexora-a-worker-1 node deploy/scripts/archive-query.mjs a --batch <uuid>
 */
import { parseArgs } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { matchesArchiveEvent, readVerifiedArchive, verifyManifestChecksum } from "./archive-query-lib.mjs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    batch: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    limit: { type: "string", default: "50" },
    "max-manifests": { type: "string", default: "100" },
  },
  allowPositionals: true,
});
const instanceId = process.env.NEXORA_ISSUER_INSTANCE_ID;
if (!instanceId || (positionals[0] && instanceId !== `nexora-${positionals[0]}`) ||
  !process.env.CORE_DATABASE_URL || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY ||
  !process.env.S3_SECRET_KEY || !process.env.S3_BUCKET_PRIVATE) {
  console.error("ARCHIVE_QUERY_CONFIG_MISSING: run inside the matching worker container");
  process.exit(2);
}
const limit = Number(values.limit);
const maxManifests = Number(values["max-manifests"]);
const from = values.from ? new Date(values.from) : undefined;
const to = values.to ? new Date(values.to) : undefined;
if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
  !Number.isInteger(maxManifests) || maxManifests < 1 || maxManifests > 1000 ||
  (from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) ||
  (from && to && from > to)) {
  console.error("ARCHIVE_QUERY_FILTER_INVALID");
  process.exit(2);
}

const core = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});
try {
  let cursor;
  let verified = 0;
  let matched = 0;
  const events = [];
  while (verified < maxManifests) {
    const page = await core.coreRecord.findMany({
      where: { kind: "archive_manifest", sourceType: "archive_partition",
        sourceId: { startsWith: `${instanceId}/` } },
      orderBy: { id: "asc" },
      take: Math.min(100, maxManifests - verified),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    for (const record of page) {
      const manifest = record.payload;
      verifyManifestChecksum(manifest, record.checksumHex);
      const object = await s3.send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_PRIVATE,
        Key: manifest.objectKey,
      }), { abortSignal: AbortSignal.timeout(30000) });
      if (!object.Body) throw new Error("ARCHIVE_OBJECT_MISSING");
      const bytes = await object.Body.transformToByteArray();
      const rows = readVerifiedArchive(manifest, bytes);
      verified++;
      for (const row of rows) {
        if (!matchesArchiveEvent(row, { batchId: values.batch, from, to })) continue;
        matched++;
        if (events.length < limit) events.push({
          id: row.id,
          eventType: row.eventType,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          deliveredAt: row.deliveredAt,
          sourceManifestId: record.id,
        });
      }
    }
    cursor = page[page.length - 1].id;
  }
  console.log(JSON.stringify({ instanceId, batchId: values.batch ?? null,
    from: from?.toISOString() ?? null, to: to?.toISOString() ?? null,
    manifestsVerified: verified, matchedEvents: matched, returnedEvents: events.length,
    manifestLimitReached: verified === maxManifests, events }, null, 2));
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("ARCHIVE_")
    ? error.message : "ARCHIVE_QUERY_FAILED");
  process.exitCode = 1;
} finally {
  await core.$disconnect();
  s3.destroy();
}

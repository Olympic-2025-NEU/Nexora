// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Async archive export: delivered outbox events → private JSONL → archive_manifest.
 * Must never run inside the OLTP confirm transaction.
 */
import { createHash, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Prisma, PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";

const KIND = "archive_manifest";
const SOURCE_TYPE = "archive_partition";
const POLICY = "p12-t02-v1";
const BATCH = 200;

type ArchiveEnv = {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET_PRIVATE: string;
  S3_REGION?: string;
  NEXORA_ISSUER_INSTANCE_ID: string;
};

function checksum(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)!, "utf8").digest("hex");
}

function objectSha(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function partitionParts(instanceId: string, occurredAt: Date, eventType: string) {
  const year = String(occurredAt.getUTCFullYear());
  const month = String(occurredAt.getUTCMonth() + 1).padStart(2, "0");
  const safeType = eventType.replace(/[^a-zA-Z0-9._-]/g, "_");
  return { year, month, eventType: safeType, instanceId };
}

export function createArchiveExporter(
  app: PrismaClient,
  core: PrismaClient,
  env: ArchiveEnv,
  putArchive?: (key: string, body: Buffer, sha256Hex: string) => Promise<void>,
) {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    // Property names match AWS SDK; values are env refs only (gitleaks:allow).
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env["S3_SECRET_KEY"] },
  });

  async function globalCheckpoint(): Promise<string | null> {
    const rows = await core.coreRecord.findMany({
      where: {
        kind: KIND,
        sourceType: SOURCE_TYPE,
        sourceId: { startsWith: `${env.NEXORA_ISSUER_INSTANCE_ID}/` },
      },
      orderBy: { builtAt: "desc" },
      take: 50,
    });
    let best: string | null = null;
    for (const row of rows) {
      const payload = row.payload as { checkpoint?: string };
      if (typeof payload.checkpoint === "string" &&
        (!best || payload.checkpoint > best)) best = payload.checkpoint;
    }
    return best;
  }

  function stampOf(row: { id: string; deliveredAt: Date | null; createdAt: Date }): string {
    return `${(row.deliveredAt ?? row.createdAt).toISOString()}|${row.id}`;
  }

  async function exportOnce(): Promise<{ exported: number; skipped: number }> {
    const instanceId = env.NEXORA_ISSUER_INSTANCE_ID;
    const watermark = await globalCheckpoint();
    const [checkpointTime, checkpointId] = watermark?.split("|") ?? [];
    if (watermark && (!checkpointId || Number.isNaN(new Date(checkpointTime).getTime()))) {
      throw new Error("Invalid archive checkpoint");
    }
    const delivered = await app.outboxMessage.findMany({
      where: {
        status: "delivered",
        deliveredAt: { not: null },
        ...(watermark ? {
          OR: [
            { deliveredAt: { gt: new Date(checkpointTime) } },
            { deliveredAt: new Date(checkpointTime), id: { gt: checkpointId } },
          ],
        } : {}),
      },
      orderBy: [{ deliveredAt: "asc" }, { id: "asc" }],
      take: BATCH,
    });
    if (!delivered.length) return { exported: 0, skipped: 0 };

    // Keep partitions contiguous so a failed write cannot advance the checkpoint
    // past an earlier event from another partition in the same batch.
    const groups: { partition: string; rows: typeof delivered }[] = [];
    for (const row of delivered) {
      const at = row.deliveredAt ?? row.createdAt;
      const parts = partitionParts(instanceId, at, row.eventType);
      const key = `${parts.instanceId}/${parts.year}/${parts.month}/${parts.eventType}`;
      const last = groups[groups.length - 1];
      if (last?.partition === key) last.rows.push(row);
      else groups.push({ partition: key, rows: [row] });
    }

    let exported = 0;
    let skipped = 0;
    for (const { partition, rows } of groups) {
      const lines = rows.map((row) => JSON.stringify({
        id: row.id,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.aggregateVersion,
        correlationId: row.correlationId,
        deliveredAt: (row.deliveredAt ?? row.createdAt).toISOString(),
        payload: row.payload,
      }));
      const body = Buffer.from(`${lines.join("\n")}\n`, "utf8");
      const sha256Hex = objectSha(body);
      const runId = sha256Hex;
      const objectKey = `archive/${partition}/${runId}.jsonl`;
      if (putArchive) await putArchive(objectKey, body, sha256Hex);
      else await s3.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET_PRIVATE,
        Key: objectKey,
        Body: body,
        ContentLength: body.length,
        ContentType: "application/x-ndjson",
        Metadata: { sha256: sha256Hex },
      }), { abortSignal: AbortSignal.timeout(30000) });

      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      const firstAt = (first.deliveredAt ?? first.createdAt).toISOString();
      const lastAt = (last.deliveredAt ?? last.createdAt).toISOString();
      const checkpoint = stampOf(last);
      const sourceId = `${partition}/${runId}`;
      const payload = {
        schemaVersion: 1 as const,
        objectKey,
        sha256Hex,
        recordCount: rows.length,
        firstOccurredAt: firstAt,
        lastOccurredAt: lastAt,
        sourceMinId: first.id,
        sourceMaxId: last.id,
        exportedAt: new Date().toISOString(),
        checkpoint,
        format: "jsonl" as const,
      };
      const checksumHex = checksum(payload);
      try {
        await core.coreRecord.create({
          data: {
            id: randomUUID(),
            kind: KIND,
            sourceType: SOURCE_TYPE,
            sourceId,
            payload: payload as Prisma.InputJsonValue,
            visibility: "private",
            policyVersion: POLICY,
            checksumHex,
            builtAt: new Date(payload.exportedAt),
          },
        });
        exported += rows.length;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P2002") {
          skipped += rows.length;
          continue;
        }
        throw error;
      }
    }
    return { exported, skipped };
  }

  return { exportOnce };
}

export async function archiveLag(core: PrismaClient): Promise<{ manifests: number; lagSeconds: number }> {
  const latest = await core.coreRecord.findFirst({
    where: { kind: KIND, sourceType: SOURCE_TYPE },
    orderBy: { builtAt: "desc" },
  });
  if (!latest) return { manifests: 0, lagSeconds: -1 };
  const count = await core.coreRecord.count({ where: { kind: KIND, sourceType: SOURCE_TYPE } });
  return {
    manifests: count,
    lagSeconds: Math.max(0, Math.floor((Date.now() - latest.builtAt.getTime()) / 1000)),
  };
}

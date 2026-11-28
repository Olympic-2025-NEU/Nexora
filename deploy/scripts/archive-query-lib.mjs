// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function readVerifiedArchive(manifest, bytes) {
  if (!manifest || typeof manifest.objectKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256Hex ?? "")) {
    throw new Error("ARCHIVE_MANIFEST_INVALID");
  }
  if (sha256(bytes) !== manifest.sha256Hex) throw new Error("ARCHIVE_CHECKSUM_MISMATCH");
  const records = Buffer.from(bytes).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  if (records.length !== manifest.recordCount) throw new Error("ARCHIVE_RECORD_COUNT_MISMATCH");
  return records;
}

export function verifyManifestChecksum(manifest, checksumHex) {
  if (sha256(canonicalize(manifest)) !== checksumHex) throw new Error("ARCHIVE_MANIFEST_CHECKSUM_MISMATCH");
}

function containsBatch(value, batchId, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return false;
  if (Array.isArray(value)) return value.some((item) => containsBatch(item, batchId, depth + 1));
  return Object.entries(value).some(([key, item]) =>
    (["batchId", "lotId", "localBatchId"].includes(key) && item === batchId) ||
    containsBatch(item, batchId, depth + 1));
}

export function matchesArchiveEvent(event, { batchId, from, to }) {
  const at = new Date(event.deliveredAt).getTime();
  if (!Number.isFinite(at)) return false;
  if (from && at < from.getTime()) return false;
  if (to && at > to.getTime()) return false;
  if (batchId && event.aggregateId !== batchId && !containsBatch(event.payload, batchId)) return false;
  return true;
}

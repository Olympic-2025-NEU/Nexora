// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import canonicalize from "canonicalize";

test("archive_manifest payload checksum is JCS stable", () => {
  const payload = {
    schemaVersion: 1,
    objectKey: "archive/nexora-a/2026/11/goods.receipt.confirmed/run.jsonl",
    sha256Hex: "a".repeat(64),
    recordCount: 2,
    firstOccurredAt: "2026-11-27T00:00:00.000Z",
    lastOccurredAt: "2026-11-27T00:01:00.000Z",
    sourceMinId: "00000000-0000-4000-8000-000000000001",
    sourceMaxId: "00000000-0000-4000-8000-000000000002",
    exportedAt: "2026-11-27T00:02:00.000Z",
    checkpoint: "2026-11-27T00:01:00.000Z|00000000-0000-4000-8000-000000000002",
    format: "jsonl",
  };
  const a = createHash("sha256").update(canonicalize(payload)!, "utf8").digest("hex");
  const b = createHash("sha256").update(canonicalize({ ...payload })!, "utf8").digest("hex");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("confirm path must not import archive exporter", async () => {
  const { readFileSync } = await import("node:fs");
  const trading = readFileSync("contexts/trading/application/documents.ts", "utf8");
  assert.doesNotMatch(trading, /archive-export|archive_manifest/);
});

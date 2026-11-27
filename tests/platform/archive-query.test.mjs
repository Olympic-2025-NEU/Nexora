// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import canonicalize from "canonicalize";
import { matchesArchiveEvent, readVerifiedArchive, verifyManifestChecksum } from "../../deploy/scripts/archive-query-lib.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("archive query verifies the manifest and object before reporting events", () => {
  const row = { id: "event-1", eventType: "receipt.confirmed.v1", aggregateId: "doc-1",
    deliveredAt: "2026-11-27T00:00:00.000Z", payload: { lines: [{ batchId: "batch-1" }] } };
  const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
  const manifest = { objectKey: "archive/nexora-a/2026/11/receipt.confirmed.v1/run.jsonl",
    sha256Hex: sha256(bytes), recordCount: 1 };
  verifyManifestChecksum(manifest, sha256(canonicalize(manifest)));
  assert.deepEqual(readVerifiedArchive(manifest, bytes), [row]);
  assert.equal(matchesArchiveEvent(row, { batchId: "batch-1",
    from: new Date("2026-11-26T00:00:00.000Z"), to: new Date("2026-11-28T00:00:00.000Z") }), true);
  assert.equal(matchesArchiveEvent(row, { batchId: "batch-2" }), false);
  assert.throws(() => readVerifiedArchive(manifest, Buffer.from("tampered\n")), /ARCHIVE_CHECKSUM_MISMATCH/);
  assert.throws(() => verifyManifestChecksum({ ...manifest, recordCount: 2 },
    sha256(canonicalize(manifest))), /ARCHIVE_MANIFEST_CHECKSUM_MISMATCH/);
});

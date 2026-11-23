// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

export type ApprovalLine = {
  lineNo: number; warehouseId: string; productId: string; batchId: string;
  quantity: number; unit: string;
};

export function computeLineSnapshotSha256(lines: readonly ApprovalLine[]): string {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  if (!ordered.length || ordered.some((line, index) =>
    !Number.isSafeInteger(line.lineNo) || line.lineNo < 1 ||
    (index > 0 && ordered[index - 1].lineNo === line.lineNo) ||
    !Number.isFinite(line.quantity) || line.quantity <= 0 ||
    [line.warehouseId, line.productId, line.batchId, line.unit].some((value) => !value)))
    throw new Error("Invalid approval lines");
  const serialized = canonicalize(ordered.map(({ lineNo, warehouseId, productId, batchId, quantity, unit }) =>
    ({ lineNo, warehouseId, productId, batchId, quantity, unit })));
  if (!serialized) throw new Error("Cannot canonicalize approval lines");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

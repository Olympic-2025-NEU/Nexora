// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import { DomainError } from "@/platform/kernel/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse body.warehouseIds: missing → []; non-array → 422; each id must be UUID. */
export function parseWarehouseIds(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new DomainError("WAREHOUSE_IDS_INVALID", 422);
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !UUID_RE.test(item)) {
      throw new DomainError("WAREHOUSE_ID_INVALID", 422);
    }
    ids.push(item);
  }
  return [...new Set(ids)];
}

/** Ensure every warehouse id exists and is active (for new scope grants). */
export async function assertActiveWarehouses(
  tx: Prisma.TransactionClient,
  warehouseIds: readonly string[],
): Promise<void> {
  if (warehouseIds.length === 0) return;
  const rows = await tx.warehouse.findMany({
    where: { id: { in: [...warehouseIds] } },
    select: { id: true, status: true },
  });
  if (rows.length !== warehouseIds.length) {
    throw new DomainError("WAREHOUSE_NOT_FOUND", 422);
  }
  if (rows.some((row) => row.status !== "active")) {
    throw new DomainError("WAREHOUSE_NOT_ACTIVE", 422);
  }
}

/** Calendar date YYYY-MM-DD in the given IANA timezone (falls back to UTC). */
export function todayInTimezone(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

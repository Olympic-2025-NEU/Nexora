// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  MovementKind,
  StockBalanceRecord,
  StockMovementRecord,
  WarehouseRecord,
  WarehouseStatus,
} from "../domain/types";

type Db = PrismaClient | Prisma.TransactionClient;

function mapWarehouse(row: {
  id: string;
  code: string;
  name: string;
  status: string;
  version: number;
  createdBySub: string;
}): WarehouseRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as WarehouseStatus,
    version: row.version,
    createdBySub: row.createdBySub,
  };
}

function mapBalance(row: {
  warehouseId: string;
  batchId: string;
  productId: string;
  productVariantId: string;
  quantity: Prisma.Decimal;
  version: number;
  updatedAt: Date;
  variant: {
    uoms: { uomId: string; isStockKeeping: boolean; uom: { kind: string } }[];
  };
}): StockBalanceRecord {
  const stock = row.variant.uoms.find((u) => u.isStockKeeping);
  return {
    warehouseId: row.warehouseId,
    batchId: row.batchId,
    productId: row.productId,
    productVariantId: row.productVariantId,
    stockUomId: stock?.uomId ?? "",
    unitKind: (stock?.uom.kind ?? "count") as StockBalanceRecord["unitKind"],
    quantity: row.quantity,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function mapMovement(row: {
  id: string;
  createdAt: Date;
  warehouseId: string;
  batchId: string;
  productId: string;
  productVariantId: string;
  sourceLineId: string;
  kind: string;
  delta: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  actorSub: string;
  correlationId: string;
  reversalOf: string | null;
}): StockMovementRecord {
  return {
    id: row.id,
    createdAt: row.createdAt,
    warehouseId: row.warehouseId,
    batchId: row.batchId,
    productId: row.productId,
    productVariantId: row.productVariantId,
    sourceLineId: row.sourceLineId,
    kind: row.kind as MovementKind,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    actorSub: row.actorSub,
    correlationId: row.correlationId,
    reversalOf: row.reversalOf,
  };
}

/** Combine an optional exact warehouse filter with an optional scope allow-list. */
function warehouseFilter(
  warehouseId: string | undefined,
  scopeIds: readonly string[] | undefined,
): Prisma.StringFilter | string | undefined {
  if (scopeIds === undefined) return warehouseId;
  if (warehouseId === undefined) return { in: [...scopeIds] };
  return { in: scopeIds.includes(warehouseId) ? [warehouseId] : [] };
}

export function createInventoryRepos(db: Db) {
  return {
    async listWarehouses(filters: {
      status?: WarehouseStatus;
      /** When set, restrict to these warehouse ids (non-administrator scope). */
      scopeIds?: readonly string[];
      cursorId?: string;
      limit: number;
    }): Promise<{ items: WarehouseRecord[]; nextCursorId: string | null }> {
      const rows = await db.warehouse.findMany({
        where: {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.scopeIds ? { id: { in: [...filters.scopeIds] } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
      });
      const hasMore = rows.length > filters.limit;
      const page = hasMore ? rows.slice(0, filters.limit) : rows;
      return {
        items: page.map(mapWarehouse),
        nextCursorId: hasMore ? page[page.length - 1]!.id : null,
      };
    },

    async findWarehouseById(id: string): Promise<WarehouseRecord | null> {
      const row = await db.warehouse.findUnique({ where: { id } });
      return row ? mapWarehouse(row) : null;
    },

    async createWarehouse(input: {
      id: string;
      code: string;
      name: string;
      createdBySub: string;
    }): Promise<WarehouseRecord> {
      const row = await db.warehouse.create({
        data: {
          id: input.id,
          code: input.code,
          name: input.name,
          status: "active",
          createdBySub: input.createdBySub,
        },
      });
      return mapWarehouse(row);
    },

    /** Optimistic on `version`. Returns null on miss or stale version. */
    async updateWarehouse(
      id: string,
      expectedVersion: number,
      patch: { name?: string; status?: WarehouseStatus },
    ): Promise<WarehouseRecord | null> {
      const updated = await db.warehouse.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      const row = await db.warehouse.findUniqueOrThrow({ where: { id } });
      return mapWarehouse(row);
    },

    async hasPositiveBalance(warehouseId: string): Promise<boolean> {
      const row = await db.stockBalance.findFirst({
        where: { warehouseId, quantity: { gt: 0 } },
        select: { batchId: true },
      });
      return row !== null;
    },

    /** Stable order (warehouseId, batchId); cursor is the last returned composite key. */
    async listBalances(filters: {
      warehouseId?: string;
      productId?: string;
      productVariantId?: string;
      batchId?: string;
      scopeIds?: readonly string[];
      cursor?: { warehouseId: string; batchId: string };
      limit: number;
    }): Promise<{ items: StockBalanceRecord[]; next: { warehouseId: string; batchId: string } | null }> {
      const warehouse = warehouseFilter(filters.warehouseId, filters.scopeIds);
      const rows = await db.stockBalance.findMany({
        where: {
          ...(warehouse !== undefined ? { warehouseId: warehouse } : {}),
          ...(filters.productId ? { productId: filters.productId } : {}),
          ...(filters.productVariantId ? { productVariantId: filters.productVariantId } : {}),
          ...(filters.batchId ? { batchId: filters.batchId } : {}),
        },
        include: {
          variant: {
            select: {
              uoms: {
                where: { isStockKeeping: true },
                select: { uomId: true, isStockKeeping: true, uom: { select: { kind: true } } },
              },
            },
          },
        },
        orderBy: [{ warehouseId: "asc" }, { batchId: "asc" }],
        take: filters.limit + 1,
        ...(filters.cursor
          ? {
              cursor: {
                warehouseId_batchId: {
                  warehouseId: filters.cursor.warehouseId,
                  batchId: filters.cursor.batchId,
                },
              },
              skip: 1,
            }
          : {}),
      });
      const hasMore = rows.length > filters.limit;
      const page = hasMore ? rows.slice(0, filters.limit) : rows;
      const last = page[page.length - 1];
      return {
        items: page.map(mapBalance),
        next: hasMore && last ? { warehouseId: last.warehouseId, batchId: last.batchId } : null,
      };
    },

    /** Stable order (createdAt DESC, id DESC); cursor is the last movement id. */
    async listMovements(filters: {
      warehouseId?: string;
      batchId?: string;
      scopeIds?: readonly string[];
      cursorId?: string;
      limit: number;
    }): Promise<{ items: StockMovementRecord[]; nextCursorId: string | null }> {
      const warehouse = warehouseFilter(filters.warehouseId, filters.scopeIds);
      const rows = await db.stockMovement.findMany({
        where: {
          ...(warehouse !== undefined ? { warehouseId: warehouse } : {}),
          ...(filters.batchId ? { batchId: filters.batchId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
      });
      const hasMore = rows.length > filters.limit;
      const page = hasMore ? rows.slice(0, filters.limit) : rows;
      return {
        items: page.map(mapMovement),
        nextCursorId: hasMore ? page[page.length - 1]!.id : null,
      };
    },

    async listMembershipWarehouses(membershipId: string): Promise<string[]> {
      const rows = await db.membershipWarehouse.findMany({
        where: { membershipId },
        orderBy: { warehouseId: "asc" },
        select: { warehouseId: true },
      });
      return rows.map((row) => row.warehouseId);
    },

    /** Replace the full warehouse scope of a membership (run inside the command tx). */
    async replaceMembershipWarehouses(
      membershipId: string,
      warehouseIds: readonly string[],
    ): Promise<string[]> {
      const unique = [...new Set(warehouseIds)].sort();
      await db.membershipWarehouse.deleteMany({ where: { membershipId } });
      if (unique.length > 0) {
        await db.membershipWarehouse.createMany({
          data: unique.map((warehouseId) => ({ membershipId, warehouseId })),
        });
      }
      return unique;
    },
  };
}

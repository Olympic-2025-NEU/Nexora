// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma, PrismaClient } from "@prisma/client";
import type { BaseUnit } from "../domain/quantity";
import type {
  BatchRecord,
  IdentifierKind,
  ProductIdentifierRecord,
  ProductRecord,
  ProductStatus,
  QualityStatus,
} from "../domain/types";

type Db = PrismaClient | Prisma.TransactionClient;

export type CatalogPage<T> = { items: T[]; nextCursorId: string | null };

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function mapProduct(row: {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  baseUnit: string;
  status: string;
  version: number;
  createdBySub: string;
}): ProductRecord {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    baseUnit: row.baseUnit as BaseUnit,
    status: row.status as ProductStatus,
    version: row.version,
    createdBySub: row.createdBySub,
  };
}

function mapIdentifier(row: {
  id: string;
  productId: string;
  kind: string;
  value: string;
  isPrimary: boolean;
}): ProductIdentifierRecord {
  return {
    id: row.id,
    productId: row.productId,
    kind: row.kind as IdentifierKind,
    value: row.value,
    isPrimary: row.isPrimary,
  };
}

function mapBatch(row: {
  id: string;
  productId: string;
  localCode: string;
  originIssuerInstanceId: string;
  originLotId: string;
  manufacturedOn: Date | null;
  expiresOn: Date | null;
  qualityStatus: string;
  sourcePartnerId: string | null;
  version: number;
}): BatchRecord {
  return {
    id: row.id,
    productId: row.productId,
    localCode: row.localCode,
    originIssuerInstanceId: row.originIssuerInstanceId,
    originLotId: row.originLotId,
    manufacturedOn: dateOnly(row.manufacturedOn),
    expiresOn: dateOnly(row.expiresOn),
    qualityStatus: row.qualityStatus as QualityStatus,
    sourcePartnerId: row.sourcePartnerId,
    version: row.version,
  };
}

function finishPage<T extends { id: string }>(rows: T[], limit: number): CatalogPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursorId: hasMore ? items[items.length - 1]!.id : null };
}

export function createCatalogRepos(db: Db) {
  return {
    async listProducts(filters: {
      q?: string;
      status?: ProductStatus;
      cursorId?: string;
      limit: number;
    }): Promise<CatalogPage<ProductRecord>> {
      const q = filters.q?.trim();
      const where: Prisma.ProductWhereInput = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(q
          ? {
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { identifiers: { some: { value: q } } },
              ],
            }
          : {}),
      };
      const rows = await db.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
      });
      return finishPage(rows.map(mapProduct), filters.limit);
    },

    async findProductById(id: string): Promise<ProductRecord | null> {
      const row = await db.product.findUnique({ where: { id } });
      return row ? mapProduct(row) : null;
    },

    async createProduct(input: {
      id: string;
      sku: string;
      name: string;
      description?: string | null;
      baseUnit: BaseUnit;
      createdBySub: string;
    }): Promise<ProductRecord> {
      const row = await db.product.create({
        data: {
          id: input.id,
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          baseUnit: input.baseUnit,
          status: "active",
          createdBySub: input.createdBySub,
        },
      });
      return mapProduct(row);
    },

    /** SKU and baseUnit are immutable; optimistic on `version`. Returns null on miss/conflict. */
    async updateProduct(
      id: string,
      expectedVersion: number,
      patch: { name?: string; description?: string | null; status?: ProductStatus },
    ): Promise<ProductRecord | null> {
      const updated = await db.product.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      const row = await db.product.findUniqueOrThrow({ where: { id } });
      return mapProduct(row);
    },

    async listIdentifiers(productId: string): Promise<ProductIdentifierRecord[]> {
      const rows = await db.productIdentifier.findMany({
        where: { productId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(mapIdentifier);
    },

    /** A new primary demotes the existing primary of the same (product, kind) in the same tx. */
    async createIdentifier(input: {
      id: string;
      productId: string;
      kind: IdentifierKind;
      value: string;
      isPrimary: boolean;
    }): Promise<ProductIdentifierRecord> {
      if (input.isPrimary) {
        await db.productIdentifier.updateMany({
          where: { productId: input.productId, kind: input.kind, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const row = await db.productIdentifier.create({
        data: {
          id: input.id,
          productId: input.productId,
          kind: input.kind,
          value: input.value,
          isPrimary: input.isPrimary,
        },
      });
      return mapIdentifier(row);
    },

    async listBatches(filters: {
      productId?: string;
      issuer?: string;
      status?: QualityStatus;
      expiresBefore?: string;
      cursorId?: string;
      limit: number;
    }): Promise<CatalogPage<BatchRecord>> {
      const rows = await db.batch.findMany({
        where: {
          ...(filters.productId ? { productId: filters.productId } : {}),
          ...(filters.issuer ? { originIssuerInstanceId: filters.issuer } : {}),
          ...(filters.status ? { qualityStatus: filters.status } : {}),
          ...(filters.expiresBefore ? { expiresOn: { lt: parseDateOnly(filters.expiresBefore)! } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
      });
      return finishPage(rows.map(mapBatch), filters.limit);
    },

    async findBatchById(id: string): Promise<BatchRecord | null> {
      const row = await db.batch.findUnique({ where: { id } });
      return row ? mapBatch(row) : null;
    },

    async createBatch(input: {
      id: string;
      productId: string;
      localCode: string;
      originIssuerInstanceId: string;
      originLotId: string;
      manufacturedOn?: string | null;
      expiresOn?: string | null;
      sourcePartnerId?: string | null;
      createdBySub: string;
    }): Promise<BatchRecord> {
      const row = await db.batch.create({
        data: {
          id: input.id,
          productId: input.productId,
          localCode: input.localCode,
          originIssuerInstanceId: input.originIssuerInstanceId,
          originLotId: input.originLotId,
          manufacturedOn: parseDateOnly(input.manufacturedOn),
          expiresOn: parseDateOnly(input.expiresOn),
          qualityStatus: "inspect",
          sourcePartnerId: input.sourcePartnerId ?? null,
          createdBySub: input.createdBySub,
        },
      });
      return mapBatch(row);
    },

    /** Optimistic on `version`. Returns null when the row is missing or the version is stale. */
    async updateBatchQuality(
      id: string,
      expectedVersion: number,
      qualityStatus: QualityStatus,
    ): Promise<BatchRecord | null> {
      const updated = await db.batch.updateMany({
        where: { id, version: expectedVersion },
        data: { qualityStatus, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      const row = await db.batch.findUniqueOrThrow({ where: { id } });
      return mapBatch(row);
    },
  };
}

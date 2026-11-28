// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";
import {
  canonicalUomDisplayName,
  normalizeSearchKey,
  normalizeVariantCode,
  uomNameKey,
} from "../domain/normalize-uom";
import {
  buildVariantCodeBase,
  suggestVariantCode as allocateSuggestedVariantCode,
} from "../domain/suggest-variant-code";
import type {
  BatchRecord,
  CategoryRecord,
  PriceListItemRecord,
  PriceListRecord,
  PriceType,
  ProductImageRecord,
  ProductListItem,
  ProductRecord,
  ProductVariantRecord,
  ProductVariantUomRecord,
  QualityStatus,
  UomKind,
  UomRecord,
} from "../domain/types";

const MAX_PRODUCT_IMAGES = 5;

type Db = PrismaClient | Prisma.TransactionClient;

export type CatalogPage<T> = { items: T[]; nextCursorId: string | null };

const SYSTEM_CAI_ID = "aaaaaaaa-0001-4000-8000-000000000001";

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function asAttrs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapProduct(row: {
  id: string;
  name: string;
  searchText: string;
  attributes: unknown;
  categoryId: string;
  isActive: boolean;
  deletedAt: Date | null;
  version: number;
  createdBySub: string;
  createdAt: Date;
  updatedAt: Date;
}): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    searchText: row.searchText,
    attributes: asAttrs(row.attributes),
    categoryId: row.categoryId,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
    createdBySub: row.createdBySub,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapVariant(row: {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  isPrimary: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  version: number;
  createdBySub: string;
}): ProductVariantRecord {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    barcode: row.barcode,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
    createdBySub: row.createdBySub,
  };
}

function mapCategory(row: {
  id: string;
  code: string;
  name: string;
  nameNormalized: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  deletedAt: Date | null;
  version: number;
}): CategoryRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameNormalized: row.nameNormalized,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
  };
}

function mapUom(row: {
  id: string;
  code: string;
  name: string;
  nameKey: string;
  kind: string;
  isSystemDefault: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  version: number;
}): UomRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameKey: row.nameKey,
    kind: row.kind as UomKind,
    isSystemDefault: row.isSystemDefault,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
  };
}

function mapBatch(row: {
  id: string;
  productId: string;
  productVariantId: string;
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
    productVariantId: row.productVariantId,
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

async function syncVariantCodes(
  db: Db,
  variantId: string,
  sku: string | null,
  barcode: string | null,
): Promise<void> {
  await db.variantCode.deleteMany({ where: { variantId } });
  if (!sku && !barcode) throw new DomainError("VARIANT_CODE_REQUIRED", 422);
  const skuN = sku ? normalizeVariantCode(sku) : null;
  const barN = barcode ? normalizeVariantCode(barcode) : null;
  if (skuN && barN && skuN === barN) {
    await db.variantCode.create({ data: { code: skuN, variantId, source: "both" } });
    return;
  }
  if (skuN) await db.variantCode.create({ data: { code: skuN, variantId, source: "sku" } });
  if (barN) await db.variantCode.create({ data: { code: barN, variantId, source: "barcode" } });
}

export function createCatalogRepos(db: Db) {
  return {
    systemCaiId: SYSTEM_CAI_ID,

    async listProducts(filters: {
      q?: string;
      isActive?: boolean;
      categoryId?: string;
      categoryIds?: string[];
      includeDeleted?: boolean;
      cursorId?: string;
      limit: number;
    }): Promise<CatalogPage<ProductListItem>> {
      const q = filters.q?.trim();
      const qKey = q ? normalizeSearchKey(q) : null;
      const where: Prisma.ProductWhereInput = {
        ...(filters.includeDeleted ? {} : { deletedAt: null }),
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        ...(filters.categoryIds?.length
          ? { categoryId: { in: filters.categoryIds } }
          : filters.categoryId
            ? { categoryId: filters.categoryId }
            : {}),
        ...(qKey
          ? {
              OR: [
                { searchText: { contains: qKey, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                {
                  variants: {
                    some: {
                      deletedAt: null,
                      OR: [
                        { sku: { contains: q, mode: "insensitive" } },
                        { barcode: { contains: q, mode: "insensitive" } },
                        { codes: { some: { code: { contains: qKey.toUpperCase() } } } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };
      const rows = await db.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursorId ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
        include: {
          _count: { select: { variants: { where: { deletedAt: null } } } },
          variants: {
            where: { deletedAt: null, isPrimary: true },
            take: 1,
            select: {
              id: true,
              sku: true,
              barcode: true,
              uoms: {
                where: { isStockKeeping: true },
                take: 1,
                select: { uomId: true },
              },
            },
          },
          images: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
            take: 1,
            select: { attachmentId: true },
          },
        },
      });

      const uomIds = new Set<string>();
      const variantIds: string[] = [];
      const baseUomByVariant = new Map<string, string>();
      for (const row of rows) {
        const attrs = asAttrs(row.attributes);
        const baseUomId = typeof attrs.baseUomId === "string" ? attrs.baseUomId : null;
        if (baseUomId) uomIds.add(baseUomId);
        const primary = row.variants[0];
        const stockUomId = primary?.uoms[0]?.uomId;
        if (stockUomId) uomIds.add(stockUomId);
        if (primary?.id) {
          variantIds.push(primary.id);
          if (baseUomId) baseUomByVariant.set(primary.id, baseUomId);
        }
      }

      const [uoms, defaultList] = await Promise.all([
        uomIds.size
          ? db.uom.findMany({
              where: { id: { in: [...uomIds] }, deletedAt: null },
              select: { id: true, name: true },
            })
          : Promise.resolve([] as { id: string; name: string }[]),
        variantIds.length
          ? db.priceList.findFirst({
              where: { isDefault: true, deletedAt: null, isActive: true },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      const uomNameById = new Map(uoms.map((u) => [u.id, u.name]));

      const priceByVariant = new Map<
        string,
        { purchase: string | null; retail: string | null; wholesale: string | null }
      >();
      if (defaultList && variantIds.length) {
        const priceRows = await db.priceListItem.findMany({
          where: {
            priceListId: defaultList.id,
            productVariantId: { in: variantIds },
            isActive: true,
          },
          select: {
            productVariantId: true,
            uomId: true,
            priceType: true,
            amount: true,
          },
        });
        for (const item of priceRows) {
          const baseUomId = baseUomByVariant.get(item.productVariantId);
          if (baseUomId && item.uomId !== baseUomId) continue;
          const slot = priceByVariant.get(item.productVariantId) ?? {
            purchase: null,
            retail: null,
            wholesale: null,
          };
          const amount = item.amount.toFixed();
          if (item.priceType === "purchase") slot.purchase = amount;
          else if (item.priceType === "retail") slot.retail = amount;
          else if (item.priceType === "wholesale") slot.wholesale = amount;
          priceByVariant.set(item.productVariantId, slot);
        }
      }

      const mapped: ProductListItem[] = rows.map((row) => {
        const primary = row.variants[0];
        const product = mapProduct(row);
        const attrUomId =
          typeof product.attributes.baseUomId === "string" ? product.attributes.baseUomId : null;
        const stockUomId = primary?.uoms[0]?.uomId ?? null;
        const baseUomId = attrUomId ?? stockUomId;
        const attrPrices =
          product.attributes.prices &&
          typeof product.attributes.prices === "object" &&
          !Array.isArray(product.attributes.prices)
            ? (product.attributes.prices as Record<string, unknown>)
            : {};
        const listPrices = primary?.id ? priceByVariant.get(primary.id) : undefined;
        const pickPrice = (key: "purchase" | "retail" | "wholesale") => {
          const fromList = listPrices?.[key] ?? null;
          if (fromList != null && fromList !== "") return fromList;
          const fromAttr = attrPrices[key];
          return fromAttr != null && String(fromAttr).trim() !== "" ? String(fromAttr) : null;
        };
        return {
          ...product,
          variantCount: row._count.variants,
          primaryVariantId: primary?.id ?? null,
          primarySku: primary?.sku ?? null,
          primaryBarcode: primary?.barcode ?? null,
          baseUomId,
          baseUomName: baseUomId ? (uomNameById.get(baseUomId) ?? null) : null,
          pricePurchase: pickPrice("purchase"),
          priceRetail: pickPrice("retail"),
          priceWholesale: pickPrice("wholesale"),
          primaryImageAttachmentId: row.images[0]?.attachmentId ?? null,
        };
      });
      return finishPage(mapped, filters.limit);
    },

    async findProductById(id: string): Promise<ProductRecord | null> {
      const row = await db.product.findUnique({ where: { id } });
      return row ? mapProduct(row) : null;
    },

    async listProductImages(productId: string): Promise<ProductImageRecord[]> {
      const rows = await db.productImage.findMany({
        where: { productId, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      });
      return rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        attachmentId: row.attachmentId,
        sortOrder: row.sortOrder,
        isPrimary: row.isPrimary,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },

    async createProductImage(input: {
      id: string;
      productId: string;
      attachmentId: string;
      isPrimary?: boolean;
    }): Promise<ProductImageRecord> {
      const product = await db.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new DomainError("PRODUCT_NOT_FOUND", 404);

      const activeCount = await db.productImage.count({
        where: { productId: input.productId, deletedAt: null },
      });
      if (activeCount >= MAX_PRODUCT_IMAGES) {
        throw new DomainError("PRODUCT_IMAGE_LIMIT", 422);
      }

      const duplicate = await db.productImage.findFirst({
        where: {
          productId: input.productId,
          attachmentId: input.attachmentId,
          deletedAt: null,
        },
      });
      if (duplicate) throw new DomainError("PRODUCT_IMAGE_EXISTS", 409);

      const makePrimary = input.isPrimary === true || activeCount === 0;
      if (makePrimary) {
        await db.productImage.updateMany({
          where: { productId: input.productId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false, updatedAt: new Date() },
        });
      }

      const row = await db.productImage.create({
        data: {
          id: input.id,
          productId: input.productId,
          attachmentId: input.attachmentId,
          sortOrder: activeCount,
          isPrimary: makePrimary,
        },
      });
      return {
        id: row.id,
        productId: row.productId,
        attachmentId: row.attachmentId,
        sortOrder: row.sortOrder,
        isPrimary: row.isPrimary,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async softDeleteProductImage(
      productId: string,
      imageId: string,
    ): Promise<ProductImageRecord | null> {
      const existing = await db.productImage.findFirst({
        where: { id: imageId, productId, deletedAt: null },
      });
      if (!existing) return null;
      const row = await db.productImage.update({
        where: { id: imageId },
        data: { deletedAt: new Date(), isPrimary: false, updatedAt: new Date() },
      });
      if (existing.isPrimary) {
        const next = await db.productImage.findFirst({
          where: { productId, deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        if (next) {
          await db.productImage.update({
            where: { id: next.id },
            data: { isPrimary: true, updatedAt: new Date() },
          });
        }
      }
      return {
        id: row.id,
        productId: row.productId,
        attachmentId: row.attachmentId,
        sortOrder: row.sortOrder,
        isPrimary: row.isPrimary,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async createProduct(input: {
      id: string;
      name: string;
      categoryId: string;
      attributes?: Record<string, unknown>;
      isActive?: boolean;
      createdBySub: string;
    }): Promise<ProductRecord> {
      const row = await db.product.create({
        data: {
          id: input.id,
          name: input.name,
          searchText: normalizeSearchKey(input.name),
          attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
          categoryId: input.categoryId,
          isActive: input.isActive ?? true,
          createdBySub: input.createdBySub,
        },
      });
      return mapProduct(row);
    },

    async updateProduct(
      id: string,
      expectedVersion: number,
      patch: {
        name?: string;
        categoryId?: string;
        attributes?: Record<string, unknown>;
        isActive?: boolean;
        deletedAt?: Date | null;
      },
    ): Promise<ProductRecord | null> {
      const updated = await db.product.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.name !== undefined
            ? { name: patch.name, searchText: normalizeSearchKey(patch.name) }
            : {}),
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.attributes !== undefined
            ? { attributes: patch.attributes as Prisma.InputJsonValue }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      return mapProduct(await db.product.findUniqueOrThrow({ where: { id } }));
    },

    async listVariants(productId: string): Promise<ProductVariantRecord[]> {
      const rows = await db.productVariant.findMany({
        where: { productId, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });
      return rows.map(mapVariant);
    },

    /**
     * Suggest next SKU/barcode from product name using registry occupancy
     * (`variant_code`), plus optional in-form reserved codes.
     */
    async suggestVariantCode(input: {
      name: string;
      excludeVariantId?: string | null;
      reservedCodes?: string[];
    }): Promise<{ code: string; base: string }> {
      const base = buildVariantCodeBase(input.name);
      const normalizedBase = normalizeVariantCode(base);
      const rows = await db.variantCode.findMany({
        where: {
          code: { startsWith: normalizedBase },
          ...(input.excludeVariantId
            ? { NOT: { variantId: input.excludeVariantId } }
            : {}),
        },
        select: { code: true },
      });
      const occupied = new Set(rows.map((r) => r.code));
      for (const reserved of input.reservedCodes ?? []) {
        const trimmed = reserved.trim();
        if (!trimmed) continue;
        occupied.add(normalizeVariantCode(trimmed));
      }
      return {
        code: allocateSuggestedVariantCode(input.name, [...occupied]),
        base,
      };
    },

    async findVariantById(id: string): Promise<ProductVariantRecord | null> {
      const row = await db.productVariant.findUnique({ where: { id } });
      return row ? mapVariant(row) : null;
    },

    async createVariant(input: {
      id: string;
      productId: string;
      sku?: string | null;
      barcode?: string | null;
      isPrimary?: boolean;
      createdBySub: string;
      stockUomId?: string;
    }): Promise<ProductVariantRecord> {
      const sku = input.sku?.trim() ? input.sku.trim() : null;
      const barcode = input.barcode?.trim() ? input.barcode.trim() : null;
      if (!sku && !barcode) throw new DomainError("VARIANT_CODE_REQUIRED", 422);

      const existingPrimary = await db.productVariant.findFirst({
        where: { productId: input.productId, isPrimary: true, deletedAt: null, isActive: true },
      });
      const isPrimary = input.isPrimary ?? !existingPrimary;

      if (isPrimary && existingPrimary) {
        await db.productVariant.update({
          where: { id: existingPrimary.id },
          data: { isPrimary: false, version: { increment: 1 }, updatedAt: new Date() },
        });
      }

      try {
        const row = await db.productVariant.create({
          data: {
            id: input.id,
            productId: input.productId,
            sku,
            barcode,
            isPrimary,
            createdBySub: input.createdBySub,
          },
        });
        await syncVariantCodes(db, row.id, sku, barcode);
        const stockUomId = input.stockUomId ?? SYSTEM_CAI_ID;
        await db.productVariantUom.create({
          data: {
            id: randomUUID(),
            productVariantId: row.id,
            uomId: stockUomId,
            isStockKeeping: true,
            factorToStockUom: new Decimal(1),
          },
        });
        return mapVariant(row);
      } catch (err) {
        if (err instanceof DomainError) throw err;
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          throw new DomainError("SKU_BARCODE_CONFLICT", 409);
        }
        throw err;
      }
    },

    async updateVariant(
      id: string,
      expectedVersion: number,
      patch: {
        sku?: string | null;
        barcode?: string | null;
        isPrimary?: boolean;
        isActive?: boolean;
        deletedAt?: Date | null;
      },
    ): Promise<ProductVariantRecord | null> {
      const current = await db.productVariant.findUnique({ where: { id } });
      if (!current || current.version !== expectedVersion) return null;

      const sku = patch.sku !== undefined ? (patch.sku?.trim() ? patch.sku.trim() : null) : current.sku;
      const barcode =
        patch.barcode !== undefined
          ? patch.barcode?.trim()
            ? patch.barcode.trim()
            : null
          : current.barcode;
      if (!sku && !barcode) throw new DomainError("VARIANT_CODE_REQUIRED", 422);

      if (patch.isPrimary === true) {
        await db.productVariant.updateMany({
          where: {
            productId: current.productId,
            isPrimary: true,
            deletedAt: null,
            NOT: { id },
          },
          data: { isPrimary: false, version: { increment: 1 }, updatedAt: new Date() },
        });
      }

      try {
        const updated = await db.productVariant.updateMany({
          where: { id, version: expectedVersion },
          data: {
            sku,
            barcode,
            ...(patch.isPrimary !== undefined ? { isPrimary: patch.isPrimary } : {}),
            ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
            ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1) return null;
        await syncVariantCodes(db, id, sku, barcode);
        return mapVariant(await db.productVariant.findUniqueOrThrow({ where: { id } }));
      } catch (err) {
        if (err instanceof DomainError) throw err;
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          throw new DomainError("SKU_BARCODE_CONFLICT", 409);
        }
        throw err;
      }
    },

    async listCategories(): Promise<CategoryRecord[]> {
      const rows = await db.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return rows.map(mapCategory);
    },

    async findCategoryById(id: string): Promise<CategoryRecord | null> {
      const row = await db.category.findUnique({ where: { id } });
      return row ? mapCategory(row) : null;
    },

    async createCategory(input: {
      id: string;
      code: string;
      name: string;
      parentId?: string | null;
      sortOrder?: number;
      createdBySub: string;
    }): Promise<CategoryRecord> {
      const row = await db.category.create({
        data: {
          id: input.id,
          code: input.code.trim(),
          name: input.name.trim(),
          nameNormalized: normalizeSearchKey(input.name),
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          createdBySub: input.createdBySub,
        },
      });
      return mapCategory(row);
    },

    async updateCategory(
      id: string,
      expectedVersion: number,
      patch: {
        name?: string;
        parentId?: string | null;
        sortOrder?: number;
        isActive?: boolean;
        deletedAt?: Date | null;
      },
    ): Promise<CategoryRecord | null> {
      const updated = await db.category.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.name !== undefined
            ? { name: patch.name, nameNormalized: normalizeSearchKey(patch.name) }
            : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      return mapCategory(await db.category.findUniqueOrThrow({ where: { id } }));
    },

    /** Category id + all descendant ids (recursive CTE). */
    async categorySubtreeIds(rootId: string): Promise<string[]> {
      const rows = await db.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE tree AS (
          SELECT id FROM catalog.category WHERE id = ${rootId}::uuid AND deleted_at IS NULL
          UNION ALL
          SELECT c.id FROM catalog.category c
          INNER JOIN tree t ON c.parent_id = t.id
          WHERE c.deleted_at IS NULL
        )
        SELECT id FROM tree
      `;
      return rows.map((r) => r.id);
    },

    async listUoms(): Promise<UomRecord[]> {
      const rows = await db.uom.findMany({
        where: { deletedAt: null },
        orderBy: [{ isSystemDefault: "desc" }, { name: "asc" }],
      });
      return rows.map(mapUom);
    },

    async findUomById(id: string): Promise<UomRecord | null> {
      const row = await db.uom.findUnique({ where: { id } });
      return row ? mapUom(row) : null;
    },

    async createUom(input: {
      id: string;
      name: string;
      kind: UomKind;
    }): Promise<UomRecord> {
      const name = canonicalUomDisplayName(input.name);
      const nameKey = uomNameKey(input.name);
      try {
        const row = await db.uom.create({
          data: {
            id: input.id,
            code: nameKey,
            name,
            nameKey,
            kind: input.kind,
          },
        });
        return mapUom(row);
      } catch (err) {
        if (err instanceof Error && /Unique constraint/i.test(err.message)) {
          throw new DomainError("UOM_NORMALIZE_CONFLICT", 409);
        }
        throw err;
      }
    },

    async listVariantUoms(variantId: string): Promise<ProductVariantUomRecord[]> {
      const rows = await db.productVariantUom.findMany({
        where: { productVariantId: variantId },
      });
      return rows.map((r) => ({
        id: r.id,
        productVariantId: r.productVariantId,
        uomId: r.uomId,
        isStockKeeping: r.isStockKeeping,
        factorToStockUom: r.factorToStockUom.toFixed(),
      }));
    },

    async replaceVariantUoms(
      variantId: string,
      rows: { id: string; uomId: string; isStockKeeping: boolean; factorToStockUom: string }[],
    ): Promise<ProductVariantUomRecord[]> {
      const stock = rows.filter((r) => r.isStockKeeping);
      if (stock.length !== 1) throw new DomainError("VARIANT_UOM_STOCK_REQUIRED", 422);
      if (stock[0]!.factorToStockUom !== "1" && Number(stock[0]!.factorToStockUom) !== 1) {
        throw new DomainError("VARIANT_UOM_STOCK_FACTOR", 422);
      }
      await db.productVariantUom.deleteMany({ where: { productVariantId: variantId } });
      for (const r of rows) {
        await db.productVariantUom.create({
          data: {
            id: r.id,
            productVariantId: variantId,
            uomId: r.uomId,
            isStockKeeping: r.isStockKeeping,
            factorToStockUom: new Decimal(r.factorToStockUom),
          },
        });
      }
      return this.listVariantUoms(variantId);
    },

    async listPriceLists(): Promise<PriceListRecord[]> {
      const rows = await db.priceList.findMany({
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        isDefault: r.isDefault,
        validFrom: r.validFrom.toISOString(),
        validTo: r.validTo?.toISOString() ?? null,
        isActive: r.isActive,
        currency: r.currency,
        deletedAt: r.deletedAt?.toISOString() ?? null,
        version: r.version,
      }));
    },

    async createPriceList(input: {
      id: string;
      code?: string | null;
      name: string;
      isDefault?: boolean;
      validFrom: Date;
      validTo?: Date | null;
      currency: string;
      createdBySub: string;
    }): Promise<PriceListRecord> {
      const code = input.code?.trim() ? input.code.trim() : null;
      const isDefault = code ? false : Boolean(input.isDefault);
      try {
        const row = await db.priceList.create({
          data: {
            id: input.id,
            code,
            name: input.name,
            isDefault,
            validFrom: input.validFrom,
            validTo: input.validTo ?? null,
            currency: input.currency.toUpperCase(),
            createdBySub: input.createdBySub,
          },
        });
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          isDefault: row.isDefault,
          validFrom: row.validFrom.toISOString(),
          validTo: row.validTo?.toISOString() ?? null,
          isActive: row.isActive,
          currency: row.currency,
          deletedAt: null,
          version: row.version,
        };
      } catch (err) {
        if (err instanceof Error && /Unique constraint|price_list_one_default/i.test(err.message)) {
          throw new DomainError("PRICE_LIST_DEFAULT_EXISTS", 409);
        }
        throw err;
      }
    },

    async listPriceListItems(
      priceListId: string,
      filters?: { productVariantId?: string },
    ): Promise<PriceListItemRecord[]> {
      const rows = await db.priceListItem.findMany({
        where: {
          priceListId,
          ...(filters?.productVariantId ? { productVariantId: filters.productVariantId } : {}),
        },
      });
      return rows.map((r) => ({
        id: r.id,
        priceListId: r.priceListId,
        productVariantId: r.productVariantId,
        uomId: r.uomId,
        priceType: r.priceType as PriceType,
        amount: r.amount.toFixed(),
        isActive: r.isActive,
      }));
    },

    async createPriceListItem(input: {
      id: string;
      priceListId: string;
      productVariantId: string;
      uomId: string;
      priceType: PriceType;
      amount: string;
    }): Promise<PriceListItemRecord> {
      const vu = await db.productVariantUom.findUnique({
        where: {
          productVariantId_uomId: {
            productVariantId: input.productVariantId,
            uomId: input.uomId,
          },
        },
      });
      if (!vu) throw new DomainError("PRICE_UOM_NOT_ON_VARIANT", 422);
      const row = await db.priceListItem.create({
        data: {
          id: input.id,
          priceListId: input.priceListId,
          productVariantId: input.productVariantId,
          uomId: input.uomId,
          priceType: input.priceType,
          amount: new Decimal(input.amount),
        },
      });
      return {
        id: row.id,
        priceListId: row.priceListId,
        productVariantId: row.productVariantId,
        uomId: row.uomId,
        priceType: row.priceType as PriceType,
        amount: row.amount.toFixed(),
        isActive: row.isActive,
      };
    },

    async listBatches(filters: {
      productId?: string;
      productVariantId?: string;
      issuer?: string;
      status?: QualityStatus;
      expiresBefore?: string;
      q?: string;
      cursorId?: string;
      limit: number;
    }): Promise<CatalogPage<BatchRecord>> {
      const q = filters.q?.trim();
      const rows = await db.batch.findMany({
        where: {
          ...(filters.productId ? { productId: filters.productId } : {}),
          ...(filters.productVariantId ? { productVariantId: filters.productVariantId } : {}),
          ...(filters.issuer ? { originIssuerInstanceId: filters.issuer } : {}),
          ...(filters.status ? { qualityStatus: filters.status } : {}),
          ...(filters.expiresBefore
            ? { expiresOn: { lt: parseDateOnly(filters.expiresBefore)! } }
            : {}),
          ...(q
            ? {
              OR: [
                { localCode: { contains: q, mode: "insensitive" } },
                { originIssuerInstanceId: { contains: q, mode: "insensitive" } },
                ...(/^[0-9a-f-]{36}$/i.test(q)
                  ? [{ id: q }, { originLotId: q }, { productId: q }, { productVariantId: q }]
                  : []),
              ],
            }
            : {}),
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
      productVariantId: string;
      localCode: string;
      originIssuerInstanceId: string;
      originLotId: string;
      manufacturedOn?: string | null;
      expiresOn?: string | null;
      sourcePartnerId?: string | null;
      createdBySub: string;
    }): Promise<BatchRecord> {
      const variant = await db.productVariant.findUnique({
        where: { id: input.productVariantId },
        select: { productId: true, deletedAt: true, isActive: true },
      });
      if (!variant || variant.deletedAt || !variant.isActive) {
        throw new DomainError("VARIANT_NOT_FOUND", 404);
      }
      const row = await db.batch.create({
        data: {
          id: input.id,
          productId: variant.productId,
          productVariantId: input.productVariantId,
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
      return mapBatch(await db.batch.findUniqueOrThrow({ where: { id } }));
    },
  };
}

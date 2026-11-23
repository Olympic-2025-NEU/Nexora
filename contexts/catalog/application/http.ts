// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { AuthError, authErrorResponse } from "@/platform/identity/request-auth";
import { TokenError } from "@/platform/identity/token";
import { ActorResolutionError } from "@/platform/identity/resolve-actor";
import { PolicyError } from "@/platform/access/policy";
import { PartnerActorError } from "@/platform/identity/partner-actor";
import type {
  BatchRecord,
  CategoryRecord,
  PriceListItemRecord,
  PriceListRecord,
  ProductListItem,
  ProductRecord,
  ProductVariantRecord,
  ProductVariantUomRecord,
  UomRecord,
} from "../domain/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function ok<T>(data: T, requestId: string | null, status = 200): NextResponse {
  return NextResponse.json(
    { data, requestId: requestId ?? crypto.randomUUID() },
    { status, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

export function okList<T>(
  data: T[],
  page: { limit: number; nextCursor?: string | null },
  requestId: string | null,
): NextResponse {
  return NextResponse.json(
    {
      data,
      page: { limit: page.limit, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
      requestId: requestId ?? crypto.randomUUID(),
    },
    { status: 200, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

export function fail(code: string, status: number, requestId: string | null): NextResponse {
  return NextResponse.json(
    { error: code, status },
    { status, headers: requestId ? { "x-request-id": requestId } : {} },
  );
}

export function mapRouteError(err: unknown, requestId: string | null): NextResponse {
  if (err instanceof TokenError || err instanceof AuthError || err instanceof ActorResolutionError) {
    const status = (err as { httpStatus?: number }).httpStatus === 403 ? 403 : 401;
    return authErrorResponse((err as { code: string }).code, status as 401 | 403, requestId);
  }
  if (err instanceof PolicyError) return fail("POLICY_DENIED", 403, requestId);
  if (err instanceof PartnerActorError) return fail(err.code, err.httpStatus, requestId);
  if (err instanceof DomainError) return fail(err.code, err.httpStatus, requestId);
  if (err instanceof Error && err.message.includes("Unique constraint")) {
    return fail("CONFLICT", 409, requestId);
  }
  console.error("[catalog route] unexpected", err);
  return fail("INTERNAL_ERROR", 500, requestId);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Validate `YYYY-MM-DD` and that it is a real calendar date. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function encodeCursor(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  if (!raw) throw new DomainError("CURSOR_INVALID", 422);
  return raw;
}

/** Parse `limit` (default 20, max 100) and an opaque cursor from the query string. */
export function parsePage(searchParams: URLSearchParams): { limit: number; cursor: string | null } {
  const rawLimit = searchParams.get("limit");
  let limit = DEFAULT_PAGE_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) throw new DomainError("LIMIT_INVALID", 422);
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_PAGE_LIMIT) throw new DomainError("LIMIT_INVALID", 422);
  }
  const rawCursor = searchParams.get("cursor");
  return { limit, cursor: rawCursor ? rawCursor : null };
}

/** Decode an opaque cursor that wraps a row UUID. */
export function decodeIdCursor(cursor: string | null): string | undefined {
  if (!cursor) return undefined;
  const id = decodeCursor(cursor);
  if (!isUuid(id)) throw new DomainError("CURSOR_INVALID", 422);
  return id;
}

export function projectProduct(product: ProductRecord | ProductListItem) {
  const list = product as ProductListItem;
  return {
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    attributes: product.attributes,
    isActive: product.isActive,
    deletedAt: product.deletedAt,
    version: product.version,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    ...(typeof list.variantCount === "number"
      ? {
          variantCount: list.variantCount,
          primarySku: list.primarySku,
          primaryBarcode: list.primaryBarcode,
        }
      : {}),
  };
}

export function projectVariant(variant: ProductVariantRecord) {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    barcode: variant.barcode,
    isPrimary: variant.isPrimary,
    isActive: variant.isActive,
    deletedAt: variant.deletedAt,
    version: variant.version,
  };
}

export function projectCategory(category: CategoryRecord) {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    parentId: category.parentId,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    version: category.version,
  };
}

export function projectUom(uom: UomRecord) {
  return {
    id: uom.id,
    code: uom.code,
    name: uom.name,
    kind: uom.kind,
    isSystemDefault: uom.isSystemDefault,
    isActive: uom.isActive,
    version: uom.version,
  };
}

export function projectVariantUom(row: ProductVariantUomRecord) {
  return {
    id: row.id,
    productVariantId: row.productVariantId,
    uomId: row.uomId,
    isStockKeeping: row.isStockKeeping,
    factorToStockUom: row.factorToStockUom,
  };
}

export function projectPriceList(list: PriceListRecord) {
  return {
    id: list.id,
    code: list.code,
    name: list.name,
    isDefault: list.isDefault,
    validFrom: list.validFrom,
    validTo: list.validTo,
    isActive: list.isActive,
    currency: list.currency,
    version: list.version,
  };
}

export function projectPriceListItem(item: PriceListItemRecord) {
  return {
    id: item.id,
    priceListId: item.priceListId,
    productVariantId: item.productVariantId,
    uomId: item.uomId,
    priceType: item.priceType,
    amount: item.amount,
    isActive: item.isActive,
  };
}

export function projectBatch(batch: BatchRecord) {
  return {
    id: batch.id,
    productId: batch.productId,
    productVariantId: batch.productVariantId,
    localCode: batch.localCode,
    originLot: {
      issuerInstanceId: batch.originIssuerInstanceId,
      lotId: batch.originLotId,
    },
    qualityStatus: batch.qualityStatus,
    ...(batch.manufacturedOn ? { manufacturedOn: batch.manufacturedOn } : {}),
    ...(batch.expiresOn ? { expiresOn: batch.expiresOn } : {}),
    version: batch.version,
  };
}

export function parseIfMatchVersion(header: string | null, bodyVersion?: unknown): number | null {
  if (typeof bodyVersion === "number" && Number.isInteger(bodyVersion) && bodyVersion > 0) {
    return bodyVersion;
  }
  if (!header) return null;
  const raw = header.replace(/^W\//, "").replaceAll('"', "").trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Trimmed non-empty string within `max` characters, else a 422 DomainError(code). */
export function requireText(value: unknown, code: string, max: number): string {
  if (typeof value !== "string") throw new DomainError(code, 422);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new DomainError(code, 422);
  return trimmed;
}

/** Reject JSON bodies that are not plain objects or carry keys outside the allow-list. */
export function assertBody(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DomainError("BODY_INVALID", 422);
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new DomainError("FIELD_NOT_ALLOWED", 422);
  }
  return record;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError("BODY_INVALID", 400);
  }
}

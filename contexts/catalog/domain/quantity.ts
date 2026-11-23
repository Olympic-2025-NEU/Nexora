// SPDX-License-Identifier: AGPL-3.0-only
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/platform/kernel/errors";
import type { UomKind } from "./types";

/** @deprecated Prefer UomKind; kept for P06 test aliases (EA=count, KG=mass, L=volume). */
export type BaseUnit = "EA" | "KG" | "L";

export type QuantityUnit = BaseUnit | UomKind;

const MAX_ABS = new Decimal("100000000000000000"); // 10^17 — PG numeric(20,3) bound
const FRACTION_RE = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/;

export function toUomKind(unit: QuantityUnit): UomKind {
  if (unit === "EA" || unit === "count") return "count";
  if (unit === "KG" || unit === "mass") return "mass";
  if (unit === "L" || unit === "volume") return "volume";
  throw new DomainError("QUANTITY_UNIT_INVALID", 422);
}

/** Parse a JSON decimal string under D07 rules. Never use JS Number for stock math. */
export function parseQuantity(raw: string, unit: QuantityUnit): Decimal {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  const value = raw.trim();
  const match = FRACTION_RE.exec(value);
  if (!match) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  const fraction = match[1] ?? "";
  if (fraction.length > 3) {
    throw new DomainError("QUANTITY_PRECISION", 422);
  }
  const kind = toUomKind(unit);
  if (kind === "count" && fraction.length > 0 && !/^0+$/.test(fraction)) {
    throw new DomainError("QUANTITY_EA_FRACTION", 422);
  }
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  if (decimal.isNaN() || !decimal.isFinite()) {
    throw new DomainError("QUANTITY_INVALID", 422);
  }
  if (decimal.abs().gte(MAX_ABS)) {
    throw new DomainError("QUANTITY_OVERFLOW", 422);
  }
  return decimal;
}

export function requirePositive(quantity: Decimal): void {
  if (quantity.lte(0)) {
    throw new DomainError("QUANTITY_NOT_POSITIVE", 422);
  }
}

export function requireNonNegative(quantity: Decimal): void {
  if (quantity.lt(0)) {
    throw new DomainError("QUANTITY_NEGATIVE", 422);
  }
}

export function addQuantity(a: Decimal, b: Decimal): Decimal {
  const sum = a.add(b);
  if (sum.abs().gte(MAX_ABS)) {
    throw new DomainError("QUANTITY_OVERFLOW", 422);
  }
  return sum;
}

export function subQuantity(a: Decimal, b: Decimal): Decimal {
  return a.sub(b);
}

export function quantityToString(value: Decimal): string {
  return value.toFixed();
}

export function isBaseUnit(value: unknown): value is BaseUnit {
  return value === "EA" || value === "KG" || value === "L";
}

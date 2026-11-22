// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";

/** Validate EAN-13 (13 digits + check digit). */
export function assertValidEan13(value: string): void {
  if (!/^\d{13}$/.test(value)) {
    throw new DomainError("EAN13_INVALID", 422);
  }
  const digits = value.split("").map((d) => Number(d));
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  if (check !== digits[12]) {
    throw new DomainError("EAN13_CHECK_DIGIT", 422);
  }
}

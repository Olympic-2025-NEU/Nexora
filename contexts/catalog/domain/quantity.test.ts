// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@/platform/kernel/errors";
import {
  addQuantity,
  parseQuantity,
  quantityToString,
  requirePositive,
  subQuantity,
} from "./quantity";

function fails(code: string, fn: () => void) {
  assert.throws(fn, (err: unknown) => err instanceof DomainError && err.code === code);
}

test("parseQuantity accepts EA integer and KG/L with up to 3 decimals", () => {
  assert.equal(quantityToString(parseQuantity("12", "EA")), "12");
  assert.equal(quantityToString(parseQuantity("1.250", "KG")), "1.25");
  assert.equal(quantityToString(parseQuantity("0.001", "L")), "0.001");
});

test("parseQuantity rejects invalid / precision / EA fraction / overflow", () => {
  fails("QUANTITY_INVALID", () => parseQuantity("", "EA"));
  fails("QUANTITY_INVALID", () => parseQuantity("1.2.3", "KG"));
  fails("QUANTITY_PRECISION", () => parseQuantity("1.2345", "KG"));
  fails("QUANTITY_EA_FRACTION", () => parseQuantity("1.5", "EA"));
  fails("QUANTITY_OVERFLOW", () => parseQuantity("100000000000000000", "KG"));
});

test("requirePositive and arithmetic stay on Decimal", () => {
  const a = parseQuantity("10.5", "KG");
  fails("QUANTITY_NOT_POSITIVE", () => requirePositive(parseQuantity("0", "KG")));
  fails("QUANTITY_NOT_POSITIVE", () => requirePositive(parseQuantity("-1", "KG")));
  assert.equal(quantityToString(addQuantity(a, parseQuantity("0.5", "KG"))), "11");
  assert.equal(quantityToString(subQuantity(a, parseQuantity("0.5", "KG"))), "10");
});

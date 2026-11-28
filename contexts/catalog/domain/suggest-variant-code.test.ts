// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeVariantCode } from "./normalize-uom";
import {
  allocateVariantCode,
  buildVariantCodeBase,
  suggestVariantCode,
} from "./suggest-variant-code";

test("buildVariantCodeBase: Vinamilk example strips parens and keeps numeric token", () => {
  assert.equal(
    buildVariantCodeBase("Sữa Có Đường Ăn Kiêng Vinamilk 330ml (Bản giới hạn)"),
    "SCDAKV330ml",
  );
});

test("buildVariantCodeBase: Nho Hạt / Na Hột share base after diacritics", () => {
  assert.equal(buildVariantCodeBase("Nho Hạt 1kg"), "NH1kg");
  assert.equal(buildVariantCodeBase("Na Hột 1kg"), "NH1kg");
});

test("buildVariantCodeBase: strips double and single quotes and their contents", () => {
  assert.equal(buildVariantCodeBase('Sữa "Premium" Đỏ'), "SD");
  assert.equal(buildVariantCodeBase("Sữa 'Premium' Đỏ"), "SD");
});

test("buildVariantCodeBase: empty / symbols → SP", () => {
  assert.equal(buildVariantCodeBase(""), "SP");
  assert.equal(buildVariantCodeBase("   "), "SP");
  assert.equal(buildVariantCodeBase("(!)"), "SP");
});

test("allocateVariantCode: starts at 001 then increments", () => {
  const base = "SCDAKV330ml";
  assert.equal(allocateVariantCode(base, []), "SCDAKV330ml001");
  assert.equal(
    allocateVariantCode(base, [normalizeVariantCode("SCDAKV330ml001")]),
    "SCDAKV330ml002",
  );
});

test("suggestVariantCode: collision examples from product names", () => {
  assert.equal(suggestVariantCode("Nho Hạt 1kg", []), "NH1kg001");
  assert.equal(
    suggestVariantCode("Na Hột 1kg", [normalizeVariantCode("NH1kg001")]),
    "NH1kg002",
  );
  assert.equal(
    suggestVariantCode("Sữa Có Đường Ăn Kiêng Vinamilk 330ml (Bản giới hạn)", []),
    "SCDAKV330ml001",
  );
  assert.equal(
    suggestVariantCode("Sữa Co Đường An Khánh Việt 330ml (Hộp To)", [
      normalizeVariantCode("SCDAKV330ml001"),
    ]),
    "SCDAKV330ml002",
  );
});

test("allocateVariantCode: beyond 999 uses natural width", () => {
  assert.equal(
    allocateVariantCode("SP", [normalizeVariantCode("SP999")]),
    "SP1000",
  );
});

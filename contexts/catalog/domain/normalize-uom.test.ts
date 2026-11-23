// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalUomDisplayName, uomNameKey, normalizeVariantCode } from "./normalize-uom";

test("UOM normalize cái variants → CÁI / CAI", () => {
  for (const input of ["cái", "Cái", "CÁI", "  cái  "]) {
    assert.equal(canonicalUomDisplayName(input), "CÁI");
    assert.equal(uomNameKey(input), "CAI");
  }
});

test("variant code upper", () => {
  assert.equal(normalizeVariantCode(" abc-1 "), "ABC-1");
});

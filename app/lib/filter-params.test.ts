// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filtersToSearchParams, hasActiveFilters } from "./filter-params";

describe("filtersToSearchParams", () => {
  it("omits empty values by default", () => {
    const params = filtersToSearchParams({ q: " rice ", type: "", status: "draft" });
    assert.equal(params.get("q"), "rice");
    assert.equal(params.get("status"), "draft");
    assert.equal(params.has("type"), false);
  });

  it("keeps empty values when omitEmpty is false", () => {
    const params = filtersToSearchParams({ q: "" }, { omitEmpty: false });
    assert.equal(params.get("q"), "");
  });
});

describe("hasActiveFilters", () => {
  it("detects trimmed non-empty values", () => {
    assert.equal(hasActiveFilters({ q: "  ", type: "" }), false);
    assert.equal(hasActiveFilters({ q: "a" }), true);
  });
});

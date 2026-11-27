// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NEXT, safeNext, signInPath } from "./paths";

test("DX-Lab deep links stay on the workspace origin and path", () => {
  assert.equal(safeNext("/dxlab/data/lots/abc?tab=trace"), "/dxlab/data/lots/abc?tab=trace");
  for (const unsafe of ["//evil.test", "https://evil.test", "/admin", "/dxlab-evil",
    "/dxlab/%2e%2e/admin", "/dxlab/\\evil", "/dxlab/work#token",
    "/dxlab/%5cevil", `/dxlab/${"a".repeat(513)}`]) {
    assert.equal(safeNext(unsafe), DEFAULT_NEXT, unsafe);
  }
  assert.equal(signInPath("//evil.test", "expired"),
    "/dxlab/sign-in?next=%2Fdxlab%2Fwork&reason=expired");
});

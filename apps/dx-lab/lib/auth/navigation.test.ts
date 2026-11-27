// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { navigationForRoles } from "./navigation";

test("DX-Lab navigation follows server roles without granting admin links to staff or approver", () => {
  const links = (roles: string[]) => navigationForRoles(roles).map(({ href }) => href);
  assert.deepEqual(links(["viewer"]), [
    "/work", "/data", "/assistant", "/profile", "/partners",
  ]);
  assert.deepEqual(links(["staff"]), [
    "/work", "/operations", "/data", "/assistant", "/profile", "/partners",
  ]);
  assert.deepEqual(links(["approver"]), links(["staff"]));
  assert.deepEqual(links(["administrator"]), [
    "/work", "/operations", "/data", "/assistant", "/profile", "/partners", "/members",
  ]);
  assert.deepEqual(links([]), ["/work", "/data", "/assistant", "/profile"]);
});

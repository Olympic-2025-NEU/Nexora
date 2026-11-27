// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

test("simulated OT ingestion is authenticated and rate-limited before the API catch-all", () => {
  const config = parse(readFileSync("deploy/apisix/routes.yaml", "utf8"));
  const route = config.routes.find((row) => row.id === "ot-readings-v1");
  const catchAll = config.routes.find((row) => row.id === "erp-api-v1");
  assert.ok(route);
  assert.ok(catchAll);
  assert.ok(config.routes.indexOf(route) < config.routes.indexOf(catchAll));
  assert.deepEqual(route.methods, ["POST"]);
  assert.equal(route.uri, "/api/v1/ot/readings");
  assert.equal(route.plugins["openid-connect"].bearer_only, true);
  assert.ok(route.plugins["limit-req"].rate <= 5);
});

// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const compose = parse(readFileSync("deploy/compose.yml", "utf8"));

test("ERP and optional AI adapter receive the same private provider boundary", () => {
  const erp = compose.services.erp;
  const ai = compose.services.ai;
  assert.equal(erp.environment.AI_PROVIDER, "${AI_PROVIDER:-none}");
  assert.equal(erp.environment.AI_BASE_URL, "${AI_BASE_URL:-http://ai:8080}");
  assert.equal(erp.environment.AI_INTERNAL_TOKEN, ai.environment.AI_INTERNAL_TOKEN);
  assert.equal(erp.environment.AI_INTERNAL_TOKEN, "${AI_INTERNAL_TOKEN:-}");
  assert.deepEqual(ai.profiles, ["ai"]);
  assert.ok(!erp.depends_on?.ai, "ERP must run without AI");
  assert.ok(!ai.environment.DATABASE_URL && !ai.environment.APP_DATABASE_URL);
  assert.ok(!ai.ports && !compose.services.ollama.ports);
});

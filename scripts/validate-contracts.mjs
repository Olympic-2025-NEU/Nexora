#!/usr/bin/env node
/**
 * Validate federation envelope fixture + basic OpenAPI structure.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

const root = process.cwd();
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = join(root, "contracts/events/envelope-v1.schema.json");
const fixturePath = join(root, "contracts/events/fixtures/a-to-b-transfer-announced.json");
const openapiPath = join(root, "contracts/openapi/nexora-v1.yaml");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const validate = ajv.compile(schema);
if (!validate(fixture)) {
  console.error("envelope fixture FAILED:", validate.errors);
  process.exit(1);
}
console.log("envelope fixture: PASS");

const doc = parseYaml(readFileSync(openapiPath, "utf8"));
if (!doc?.openapi || !doc?.paths || !doc?.info?.title) {
  console.error("openapi structure FAILED: missing openapi/paths/info.title");
  process.exit(1);
}
const pathCount = Object.keys(doc.paths).length;
if (pathCount < 5) {
  console.error(`openapi structure FAILED: too few paths (${pathCount})`);
  process.exit(1);
}
console.log(`openapi structure: PASS (${pathCount} paths, version ${doc.openapi})`);
console.log("validate-contracts: OK");

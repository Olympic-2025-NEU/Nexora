// SPDX-License-Identifier: AGPL-3.0-only
/** Small, checked projection of the OpenAPI schemas used by DX-Lab T02. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";

const source = "contracts/openapi/nexora-v1.yaml";
const output = "apps/dx-lab/lib/api-client/openapi-types.ts";
const doc = parse(readFileSync(source, "utf8"));
const operation = doc.paths?.["/api/v1/me"]?.get;
const reference = operation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
if (reference !== "#/components/schemas/Me") throw new Error("OpenAPI getMe must return Me directly");

function tsType(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") return `(${tsType(schema.items)})[]`;
  throw new Error(`Unsupported OpenAPI property type: ${schema.type ?? "missing"}`);
}

const schema = doc.components?.schemas?.Me;
if (schema?.type !== "object" || !schema.properties || !Array.isArray(schema.required)) {
  throw new Error("OpenAPI Me schema missing");
}
const fields = Object.entries(schema.properties).map(([name, property]) =>
  `  ${name}${schema.required.includes(name) ? "" : "?"}: ${tsType(property)};`).join("\n");
const generated = `// SPDX-License-Identifier: AGPL-3.0-only\n// Generated from ${source} by scripts/generate-dxlab-api-types.mjs.\nexport interface Me {\n${fields}\n}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8").replaceAll("\r\n", "\n") !== generated) {
    throw new Error("DX-Lab OpenAPI types are stale. Run npm run generate:dxlab-api");
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generated);
}

// SPDX-License-Identifier: AGPL-3.0-only
/** Checked projection of OpenAPI schemas used by DX-Lab H/P/D/I clients. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";

const source = "contracts/openapi/nexora-v1.yaml";
const output = "apps/dx-lab/lib/api-client/openapi-types.ts";
const schemaNames = [
  "Me",
  "Organization",
  "OrganizationPatch",
  "Member",
  "MemberCreate",
  "MemberPatch",
  "Partner",
  "PartnerCreate",
  "PartnerPatch",
  "PartnerConnectionInput",
  "PartnerConnectionView",
  "ApprovalTask",
  "FileMetadata",
  "AiChatInput",
  "AiChatResult",
  "AiDraftProposeInput",
  "AiDraftProposeResult",
  "AiDraftCreateInput",
  "AiDraftCreateResult",
];

const doc = parse(readFileSync(source, "utf8"));
const operation = doc.paths?.["/api/v1/me"]?.get;
const reference = operation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
if (reference !== "#/components/schemas/Me") throw new Error("OpenAPI getMe must return Me directly");

const connectionGet = doc.paths?.["/api/v1/partners/{id}/connection"]?.get;
if (!connectionGet) throw new Error("OpenAPI must document GET partner connection");

function resolveRef(schema) {
  if (!schema?.$ref) return schema;
  const name = String(schema.$ref).replace("#/components/schemas/", "");
  const resolved = doc.components?.schemas?.[name];
  if (!resolved) throw new Error(`Missing OpenAPI schema ${name}`);
  return resolved;
}

function tsType(schema, depth = 0) {
  const resolved = resolveRef(schema);
  if (resolved.nullable && resolved.type) {
    return `(${tsType({ ...resolved, nullable: undefined }, depth)}) | null`;
  }
  if (Array.isArray(resolved.enum)) {
    return resolved.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (resolved.type === "string") return "string";
  if (resolved.type === "integer" || resolved.type === "number") return "number";
  if (resolved.type === "boolean") return "boolean";
  if (resolved.type === "array") return `(${tsType(resolved.items, depth + 1)})[]`;
  if (resolved.type === "object") {
    if (resolved.properties) {
      const fields = Object.entries(resolved.properties).map(([name, property]) => {
        const required = Array.isArray(resolved.required) && resolved.required.includes(name);
        return `${name}${required ? "" : "?"}: ${tsType(property, depth + 1)}`;
      });
      return `{ ${fields.join("; ")} }`;
    }
    return "Record<string, unknown>";
  }
  throw new Error(`Unsupported OpenAPI property type: ${resolved.type ?? "missing"}`);
}

function interfaceBlock(name) {
  const schema = doc.components?.schemas?.[name];
  if (schema?.type !== "object" || !schema.properties) {
    throw new Error(`OpenAPI ${name} schema missing`);
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const fields = Object.entries(schema.properties).map(([field, property]) =>
    `  ${field}${required.includes(field) ? "" : "?"}: ${tsType(property)};`).join("\n");
  return `export interface ${name} {\n${fields}\n}`;
}

const generated = [
  "// SPDX-License-Identifier: AGPL-3.0-only",
  `// Generated from ${source} by scripts/generate-dxlab-api-types.mjs.`,
  ...schemaNames.map(interfaceBlock),
  "",
].join("\n");

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8").replaceAll("\r\n", "\n") !== generated) {
    throw new Error("DX-Lab OpenAPI types are stale. Run npm run generate:dxlab-api");
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generated);
}

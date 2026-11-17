// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";
import { parse as parseYaml } from "yaml";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const openapi = parseYaml(readFileSync("contracts/openapi/nexora-v1.yaml", "utf8"));
const routeMatrix = readJson("contracts/openapi/fixtures/route-matrix-v1.json");
const requestCases = readJson("contracts/openapi/fixtures/request-cases-v1.json").cases;
const federationSchema = readJson("contracts/events/envelope-v1.schema.json");
const federationManifest = readJson("contracts/events/fixtures/manifest-v1.json");
const domainCases = readJson("contracts/events/fixtures/domain-events-v1.json").cases;
const coreCases = readJson("contracts/core-records/fixtures/payloads-v1.json").cases;
const validateFederation = ajv.compile(federationSchema);

function noDuplicateKeys(raw) {
  const stack = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index++;
      while (index < raw.length) {
        if (raw[index] === "\\") { index += 2; continue; }
        if (raw[index] === '"') break;
        index++;
      }
      assert(index < raw.length, "Unterminated JSON string");
      const frame = stack.at(-1);
      if (frame?.type === "object" && frame.key) {
        const key = JSON.parse(raw.slice(start, index + 1));
        assert(!frame.keys.has(key), `Duplicate JSON key: ${key}`);
        frame.keys.add(key);
        frame.key = false;
      }
    } else if (char === "{") stack.push({ type: "object", key: true, keys: new Set() });
    else if (char === "[") stack.push({ type: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.type === "object") stack.at(-1).key = true;
  }
}

function parseStrictJson(raw) {
  assert(Buffer.byteLength(raw, "utf8") <= 256 * 1024, "Envelope exceeds 256 KiB");
  noDuplicateKeys(raw);
  return JSON.parse(raw);
}

function milli(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
const sum = (rows, field) => rows.reduce((total, row) => total + milli(row[field]), 0n);
const hash = (value) => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");

function validateBusinessEnvelope(value, receiver, partnerIssuer) {
  assert(value.recipientInstanceId === receiver, "Wrong recipient instance");
  assert(value.issuerInstanceId === partnerIssuer, "Issuer does not match authenticated partner");
  for (const lot of value.lots) {
    assert(milli(lot.quantity) > 0n, "Lot quantity must be positive");
    if (lot.unit === "EA") assert(!lot.quantity.includes("."), "EA quantity must be integral");
  }
  if (value.eventType === "transfer.announced.v1") {
    assert(value.lots.length > 0, "Transfer needs a lot");
    assert(milli(value.sentQuantity) === sum(value.lots, "quantity"), "Transfer total differs from lots");
  }
  if (value.eventType === "receipt.confirmed.v1") {
    const sourceLineIds = new Set();
    for (const line of value.actualLines) {
      assert(!sourceLineIds.has(line.sourceLineId), "Duplicate receipt source line");
      sourceLineIds.add(line.sourceLineId);
      assert(milli(line.actualQuantity) <= milli(line.sentQuantity), "Actual exceeds sent");
      if (line.unit === "EA") {
        assert(!line.actualQuantity.includes("."), "EA actual must be integral");
        assert(!line.sentQuantity.includes("."), "EA sent must be integral");
      }
    }
    const sent = sum(value.actualLines, "sentQuantity");
    const actual = sum(value.actualLines, "actualQuantity");
    assert(milli(value.sentQuantity) === sent, "Receipt sent total mismatch");
    assert(milli(value.actualQuantity) === actual, "Receipt actual total mismatch");
    assert(milli(value.discrepancyQuantity) === sent - actual, "Receipt discrepancy mismatch");
    assert(sum(value.lots, "quantity") === actual, "Receipt lot total mismatch");
    assert(actual > 0n || value.lots.length === 0, "Zero actual requires no positive lots");
    assert(sent === actual || Boolean(value.discrepancyReason), "Discrepancy reason required");
  }
  if (value.eventType === "downstream.impact.v1") {
    assert(value.lots.length > 0, "Downstream impact needs a lot");
    for (const lot of value.lots) {
      assert(lot.originLot.issuerInstanceId === value.originLot.issuerInstanceId &&
        lot.originLot.lotId === value.originLot.lotId, "Impact changes origin lot");
    }
  }
}

function checkOpenApi() {
  assert(openapi.openapi === "3.0.3", "OpenAPI version changed");
  assert(openapi.info.version === "1.0.0", "Contract v1 is not locked");
  assert(!openapi.components.schemas.GenericData && !openapi.components.schemas.GenericWrite, "Generic placeholder schema remains");
  const actual = [];
  const ids = new Set();
  const usedBodies = new Set();
  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const name = `${method.toUpperCase()} ${path}`;
      assert(op.operationId && !ids.has(op.operationId), `Missing/duplicate operationId: ${name}`);
      ids.add(op.operationId);
      assert(Array.isArray(op.security), `Security declaration missing: ${name}`);
      assert(Array.isArray(op["x-nexora-roles"]) && op["x-nexora-scope"], `Role/scope missing: ${name}`);
      const success = Object.keys(op.responses).filter((code) => code.startsWith("2"));
      assert(success.length === 1, `Exactly one primary success response required: ${name}`);
      const expected = routeMatrix.operations.find((entry) => entry.method === method.toUpperCase() && entry.path === path);
      assert(expected, `Unexpected operation: ${name}`);
      assert(JSON.stringify(op["x-nexora-roles"]) === JSON.stringify(expected.roles) &&
        op["x-nexora-scope"] === expected.scope &&
        JSON.stringify(success) === JSON.stringify(expected.success), `Route matrix drift: ${name}`);
      const isPublic = op.security.length === 0;
      assert((isPublic ? "public" : "protected") === expected.auth, `Auth drift: ${name}`);
      if (!isPublic) {
        assert(op.responses["401"] && op.responses["403"], `Protected operation lacks 401/403: ${name}`);
      } else assert(path.startsWith("/api/v1/health/") || path.startsWith("/api/v1/public/"), `Unexpected public operation: ${name}`);
      if (path === "/api/v1/federation/events") {
        assert(op.security[0]?.bearerM2M?.length === 0, "Federation inbound must require M2M bearer");
      } else if (!isPublic) {
        assert(op.security[0]?.oidc?.length === 0, `User route must require OIDC: ${name}`);
      }
      const headers = (op.parameters ?? []).map((parameter) => parameter.$ref?.split("/").at(-1) ?? parameter.name);
      if (method === "patch" || /\/(?:confirm|cancel|submit|decision|acknowledge|resolve|quality-actions)$/.test(path)) {
        assert(headers.includes("IfMatch"), `Missing If-Match: ${name}`);
      }
      if (/\/(?:confirm|submit|decision|retry|acknowledge|resolve|quality-actions|qr)$/.test(path) ||
        path === "/api/v1/ai/drafts" || path === "/api/v1/core/records") {
        assert(headers.includes("IdempotencyKey"), `Missing Idempotency-Key: ${name}`);
      }
      const primary = op.responses[success[0]];
      if (success[0] !== "204") {
        const schema = primary.content?.["application/json"]?.schema;
        assert(schema && !JSON.stringify(schema).includes("Generic"), `Untyped response: ${name}`);
        if (path === "/api/v1/federation/events" || path.startsWith("/api/v1/health/")) {
          assert(schema.$ref, `Protocol response must be raw: ${name}`);
        } else assert(schema.properties?.data && schema.properties?.requestId, `Envelope missing: ${name}`);
      }
      if (op.requestBody) {
        const media = Object.values(op.requestBody.content)[0];
        const bodyName = media.schema?.$ref?.split("/").at(-1);
        assert(bodyName && requestCases[bodyName], `Request fixture missing: ${name}`);
        usedBodies.add(bodyName);
      }
      actual.push(name);
    }
  }
  assert(actual.length === routeMatrix.operations.length, "Route count differs from locked matrix");
  assert(usedBodies.size === Object.keys(requestCases).length, "Unused request fixture");
  const nonStock = openapi.components.schemas.NonStockDocument;
  assert(nonStock.properties.movementIds.maxItems === 0, "Transfer/sale movement contract drift");
  for (const name of ["transfers", "sales-records"]) {
    const response = openapi.paths[`/api/v1/${name}/{id}/confirm`].post.responses["200"];
    assert(JSON.stringify(response).includes("NonStockDocument"), `${name} must not create movement`);
  }
  const publicFields = Object.keys(openapi.components.schemas.PassportPublic.properties);
  for (const forbidden of ["email", "price", "stock", "credential", "rawPayload", "buyerRef"]) {
    assert(!publicFields.includes(forbidden), `Private field in public passport: ${forbidden}`);
  }
  const ackFields = Object.keys(openapi.components.schemas.FederationAck.properties);
  for (const forbidden of ["actualQuantity", "receivedQuantity", "stockBalance"]) {
    assert(!ackFields.includes(forbidden), "Technical ACK became business receiving");
  }
  for (const [name, pair] of Object.entries(requestCases)) {
    const schema = openapi.components.schemas[name];
    if (name === "FileUpload") {
      assert(schema.properties.file.format === "binary" && schema.required.includes("file"), "File multipart contract missing");
      continue;
    }
    const root = { $schema: "https://json-schema.org/draft/2020-12/schema", ...schema,
      components: { schemas: openapi.components.schemas } };
    const validate = ajv.compile(root);
    assert(validate(pair.valid), `Valid request ${name}: ${ajv.errorsText(validate.errors)}`);
    assert(!validate(pair.invalid), `Invalid request accepted: ${name}`);
  }
  console.log(`openapi: PASS (${Object.keys(openapi.paths).length} paths, ${actual.length} operations, ${usedBodies.size} request fixture pairs)`);
}

function checkEvents() {
  for (const [name, pair] of Object.entries(coreCases)) {
    const validate = ajv.compile(readJson(`contracts/core-records/${name}`));
    assert(validate(pair.valid), `Valid core payload ${name}: ${ajv.errorsText(validate.errors)}`);
    assert(!validate(pair.invalid), `Invalid core payload accepted: ${name}`);
  }
  for (const [name, pair] of Object.entries(domainCases)) {
    const validate = ajv.compile(readJson(`contracts/events/${name}`));
    assert(validate(pair.valid), `Valid domain event ${name}: ${ajv.errorsText(validate.errors)}`);
    assert(!validate(pair.invalid), `Invalid domain event accepted: ${name}`);
  }
  for (const entry of federationManifest.valid) {
    const raw = readFileSync(`contracts/events/fixtures/${entry.file}`, "utf8");
    const payload = parseStrictJson(raw);
    assert(validateFederation(payload), `Valid federation event ${entry.file}: ${ajv.errorsText(validateFederation.errors)}`);
    validateBusinessEnvelope(payload, entry.receiver, entry.partnerIssuer);
    assert(hash(payload) === entry.sha256, `JCS SHA-256 changed: ${entry.file}`);
  }
  for (const entry of federationManifest.invalid) {
    const raw = readFileSync(`contracts/events/fixtures/${entry.file}`, "utf8");
    let rejected = false;
    try {
      const payload = parseStrictJson(raw);
      if (!validateFederation(payload)) rejected = true;
      else validateBusinessEnvelope(payload, entry.receiver, entry.partnerIssuer);
    } catch { rejected = true; }
    assert(rejected, `Invalid federation event accepted: ${entry.file}`);
  }
  for (const entry of federationManifest.replay) {
    const value = parseStrictJson(readFileSync(`contracts/events/fixtures/${entry.file}`, "utf8"));
    const reference = parseStrictJson(readFileSync(`contracts/events/fixtures/${entry.reference}`, "utf8"));
    assert(value.messageId === reference.messageId, `Replay vector changed message ID: ${entry.file}`);
    assert(validateFederation(value), `Replay vector has invalid schema: ${entry.file}`);
    validateBusinessEnvelope(value, reference.recipientInstanceId, reference.issuerInstanceId);
    assert((hash(value) === hash(reference)) === entry.sameHash, `Replay hash vector mismatch: ${entry.file}`);
  }
  const chain = federationManifest.valid.map((entry) => readJson(`contracts/events/fixtures/${entry.file}`));
  const origin = chain[0].lots[0].originLot;
  for (const event of chain) {
    for (const lot of event.lots) assert(JSON.stringify(lot.originLot) === JSON.stringify(origin), "A→B→C origin lot changed");
  }
  console.log(`events: PASS (${Object.keys(coreCases).length} core pairs, ${Object.keys(domainCases).length} domain pairs, ${federationManifest.valid.length} federation valid, ${federationManifest.invalid.length} negative, ${federationManifest.replay.length} retry/hash vectors)`);
}

checkOpenApi();
checkEvents();
console.log("validate-contracts: OK (static contract checks; no runtime API claim)");

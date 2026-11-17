// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { ref, schemas, schemaTools } from "./openapi-v1-schemas.mjs";

const { obj, arr, str, uuid } = schemaTools;
const FILE = "contracts/openapi/nexora-v1.yaml";
const EVERY_USER = ["administrator", "staff", "approver", "viewer"];
const ADMIN = ["administrator"];
const WRITER = ["administrator", "staff"];
const filterTypes = {
  cursor: str(), limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  depth: { type: "integer", minimum: 1, maximum: 10 },
  id: uuid, warehouseId: uuid, productId: uuid, batchId: uuid, partnerId: uuid,
  targetId: uuid, from: str({ format: "date-time" }), to: str({ format: "date-time" }),
};

const doc = {
  openapi: "3.0.3",
  info: {
    title: "Nexora API",
    version: "1.0.0",
    description: "Phase 00 contract v1. The operations describe target behavior; only the scaffold health route is implemented today. Runtime conformance is tested in later phases.",
    license: { name: "AGPL-3.0-only", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
  },
  servers: [{ url: "https://{host}", variables: { host: { default: "nexora.example" } } }],
  tags: ["Platform", "Core", "M01", "M02", "M03", "M04", "AI01", "Operations"]
    .map((name) => ({ name, description: `${name} target contract` })),
  paths: {},
  components: {
    securitySchemes: {
      oidc: { type: "openIdConnect", openIdConnectUrl: "https://keycloak.example/.well-known/openid-configuration" },
      bearerM2M: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    parameters: {
      IfMatch: { name: "If-Match", in: "header", required: true, schema: str({ pattern: '^"[1-9][0-9]*"$' }), description: "Current aggregate version ETag." },
      IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, schema: str({ minLength: 16, maxLength: 128 }), description: "Stable across retries; reuse with different payload returns 409." },
      Cursor: { name: "cursor", in: "query", schema: filterTypes.cursor },
      Limit: { name: "limit", in: "query", schema: filterTypes.limit },
    },
    responses: {
      Error: { description: "Error envelope", content: { "application/json": { schema: ref("ErrorBody") } } },
    },
    schemas,
  },
};

const pointer = (name) => ({ $ref: `#/components/parameters/${name}` });
const errors = (codes) => Object.fromEntries(codes.map((code) => [String(code), { $ref: "#/components/responses/Error" }]));
const operationId = (method, path) => method.toLowerCase() + path.replace(/^\/api\/v1\//, "/")
  .split("/").filter(Boolean).map((part) => {
    if (part.startsWith("{")) return "By" + part.slice(1, -1).replace(/^./, (c) => c.toUpperCase());
    return part.split("-").map((word) => word.replace(/^./, (c) => c.toUpperCase())).join("");
  }).join("");

function envelope(data, list = false) {
  const properties = { data: list ? arr(data) : data, requestId: str() };
  if (list) properties.page = ref("Page");
  return obj(properties, list ? ["data", "requestId", "page"] : ["data", "requestId"]);
}

function add(method, path, tag, summary, response, options = {}) {
  const verb = method.toLowerCase();
  const auth = options.auth ?? "user";
  const isWrite = ["post", "patch", "put", "delete"].includes(verb);
  const hasId = /\{[^}]+\}/.test(path);
  const responseCode = options.status ?? (verb === "post" ? 201 : 200);
  const errorCodes = options.errors ?? (
    auth === "public"
      ? (path.includes("/health/live") ? [] : [404, 429, 503])
      : isWrite ? [400, 401, 403, ...(hasId ? [404] : []), 409, 422, 429, 503]
        : [401, 403, ...(hasId ? [404] : []), 429, 503]
  );
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1], in: "path", required: true,
    schema: match[1] === "token" ? str({ minLength: 1 }) : uuid,
  }));
  if (options.ifMatch) params.push(pointer("IfMatch"));
  if (options.idempotent) params.push(pointer("IdempotencyKey"));
  if (options.list) params.push(pointer("Cursor"), pointer("Limit"));
  for (const name of options.query ?? []) {
    if (name === "cursor" || name === "limit") continue;
    params.push({ name, in: "query", schema: filterTypes[name] ?? str() });
  }

  const body = options.body
    ? { required: true, content: {
      [options.multipart ? "multipart/form-data" : "application/json"]: { schema: ref(options.body) },
    } }
    : undefined;
  const success = responseCode === 204
    ? { description: "No content" }
    : { description: options.successDescription ?? "Success", content: {
      "application/json": { schema: options.raw ? ref(response) : envelope(
        typeof response === "string" ? ref(response) : response, Boolean(options.list),
      ) },
    } };
  const op = {
    tags: [tag],
    operationId: operationId(verb, path),
    summary,
    description: options.description ?? "Target contract; runtime implementation is tracked by the owning phase.",
    security: auth === "public" ? [] : [{ [auth === "m2m" ? "bearerM2M" : "oidc"]: [] }],
    "x-nexora-roles": auth === "public" ? [] : options.roles ?? (auth === "m2m" ? ["partner-service"] : EVERY_USER),
    "x-nexora-scope": options.scope ?? (auth === "public" ? "anonymous" : auth === "m2m" ? "partner-mapping" : "resource"),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: { [String(responseCode)]: success, ...errors(errorCodes) },
  };
  if (path === "/api/v1/files/{id}") {
    op.responses["302"] = { description: "Authorized clean-file redirect", headers: {
      Location: { schema: str({ format: "uri" }) },
    } };
  }
  (doc.paths[path] ??= {})[verb] = op;
}

const list = (path, tag, summary, schema, roles = EVERY_USER, filters = []) =>
  add("get", path, tag, summary, schema, { list: true, roles, query: filters });
const detail = (path, tag, summary, schema, roles = EVERY_USER) =>
  add("get", path, tag, summary, schema, { roles });
const create = (path, tag, summary, response, body, roles = WRITER, opts = {}) =>
  add("post", path, tag, summary, response, { body, roles, ...opts });
const patch = (path, tag, summary, response, body, roles = WRITER) =>
  add("patch", path, tag, summary, response, { body, roles, ifMatch: true });
const action = (path, tag, summary, response, options = {}) =>
  add("post", path, tag, summary, response, { status: 200, ifMatch: true, idempotent: true, roles: WRITER, ...options });

add("get", "/api/v1/health/live", "Platform", "Liveness", "HealthStatus", { auth: "public", raw: true, errors: [429] });
add("get", "/api/v1/health/ready", "Platform", "Readiness", "HealthStatus", { auth: "public", raw: true, errors: [429, 503] });
detail("/api/v1/me", "Platform", "Current actor", "Me");
detail("/api/v1/organization", "M01", "Get organization", "Organization");
patch("/api/v1/organization", "M01", "Update organization", "Organization", "OrganizationPatch", ADMIN);

list("/api/v1/members", "M01", "List members", "Member", ADMIN, ["status", "role"]);
create("/api/v1/members", "M01", "Create member", "Member", "MemberCreate", ADMIN);
patch("/api/v1/members/{id}", "M01", "Update member", "Member", "MemberPatch", ADMIN);
list("/api/v1/partners", "M01", "List partners", "Partner", EVERY_USER, ["status"]);
create("/api/v1/partners", "M01", "Create partner", "Partner", "PartnerCreate", ADMIN);
patch("/api/v1/partners/{id}", "M01", "Update partner", "Partner", "PartnerPatch", ADMIN);
add("put", "/api/v1/partners/{id}/connection", "M01", "Upsert partner connection", "PartnerConnectionView", { body: "PartnerConnectionInput", roles: ADMIN, status: 200, description: "Admin only; URLs must be HTTPS and SSRF-safe. Response never includes outboundSecretRef." });

list("/api/v1/products", "M02", "List products", "Product", EVERY_USER, ["q", "status"]);
create("/api/v1/products", "M02", "Create product", "Product", "ProductCreate");
detail("/api/v1/products/{id}", "M02", "Get product", "Product");
patch("/api/v1/products/{id}", "M02", "Update product", "Product", "ProductPatch");
create("/api/v1/products/{id}/identifiers", "M02", "Add product identifier", "ProductIdentifier", "ProductIdentifierCreate");
list("/api/v1/batches", "M02", "List batches", "Batch", EVERY_USER, ["productId", "issuer", "expiresBefore", "status"]);
create("/api/v1/batches", "M02", "Create local batch", "Batch", "BatchCreate");
detail("/api/v1/batches/{id}", "M02", "Get batch", "Batch");
action("/api/v1/batches/{id}/quality-actions", "M02", "Change batch quality", "Batch", { body: "BatchQualityAction" });
list("/api/v1/warehouses", "M02", "List warehouses", "Warehouse", EVERY_USER, ["status"]);
create("/api/v1/warehouses", "M02", "Create warehouse", "Warehouse", "WarehouseCreate");
list("/api/v1/inventory/balances", "M02", "List stock balances", "StockBalance", EVERY_USER, ["warehouseId", "productId", "batchId"]);
list("/api/v1/inventory/movements", "M02", "List stock movements", "StockMovement", EVERY_USER, ["warehouseId", "batchId"]);

const documentTypes = [
  ["receipts", "ReceiptCreate", "ReceiptPatch"],
  ["issues", "IssueCreate", "IssuePatch"],
  ["transfers", "TransferCreate", null],
  ["receivings", "ReceivingCreate", "ReceivingPatch"],
  ["stocktakes", "StocktakeCreate", "StocktakePatch"],
  ["sales-records", "SaleCreate", null],
];
for (const [name, createBody, patchBody] of documentTypes) {
  const base = `/api/v1/${name}`;
  list(base, "M03", `List ${name}`, "Document", EVERY_USER, ["status", "batchId", "partnerId", "from", "to"]);
  create(base, "M03", `Create ${name} draft`, "Document", createBody);
  detail(`${base}/{id}`, "M03", `Get ${name} document`, "Document");
  if (patchBody) patch(`${base}/{id}`, "M03", `Update ${name} draft`, "Document", patchBody);
  action(`${base}/{id}/confirm`, "M03", `Confirm ${name}`, name === "transfers" || name === "sales-records" ? "NonStockDocument" : "Document", { description: "If-Match and Idempotency-Key required. Confirm effects, audit and outbox commit in one transaction; only receipt, issue, receiving and stocktake change stock." });
  action(`${base}/{id}/cancel`, "M03", `Cancel ${name}`, "Document", { idempotent: false });
}
action("/api/v1/issues/{id}/submit", "M03", "Submit issue for approval", "Document", { status: 202 });
list("/api/v1/documents", "M03", "List documents", "Document", EVERY_USER, ["type", "status", "batchId", "partnerId", "from", "to"]);
list("/api/v1/approvals/tasks", "M03", "List approval tasks", "ApprovalTask", ["approver"], []);
action("/api/v1/approvals/{approvalRequestId}/decision", "M03", "Record approval decision intent", "ApprovalDecisionResult", { body: "ApprovalDecisionInput", roles: ["approver"], status: 202, description: "If-Match refers to approvalVersion. Creator cannot approve their own issue. Flowable completion occurs asynchronously." });

add("get", "/api/v1/lots/{id}/history", "M04", "Lot history", "TraceHistory", { query: ["cursor", "limit"] });
add("get", "/api/v1/lots/{id}/trace/backward", "M04", "Trace backward", "TraceGraph", { query: ["depth", "cursor", "limit"] });
add("get", "/api/v1/lots/{id}/trace/forward", "M04", "Trace forward", "TraceGraph", { query: ["depth", "cursor", "limit"] });
action("/api/v1/lots/{id}/qr", "M04", "Issue QR token", "QrIssued", { body: "QrCreate", ifMatch: false, status: 201 });
action("/api/v1/lots/{id}/qr/{tokenId}/revoke", "M04", "Revoke QR token", null, { body: "Reason", ifMatch: false, idempotent: false, status: 204 });
add("get", "/api/v1/public/passport/{token}", "M04", "Public product passport", "PassportPublic", { auth: "public", errors: [404, 429, 503], description: "Only allowlisted public fields; no member email, private stock, raw partner payload or unscanned files." });
add("post", "/api/v1/federation/events", "M04", "Accept federation event", "FederationAck", { auth: "m2m", body: "FederationEnvelope", raw: true, status: 202, errors: [401, 403, 409, 413, 422, 503], description: "Technical ACK after inbox commit; never confirms physical receiving or changes stock. Client ID and issuer must match partner mapping." });
list("/api/v1/federation/deliveries", "M04", "List outbound delivery status", "FederationDelivery", ADMIN, ["status", "partnerId"]);
action("/api/v1/federation/deliveries/{id}/retry", "M04", "Retry outbound delivery", "FederationRetryResult", { body: "Reason", roles: ADMIN, status: 202, ifMatch: false });

add("post", "/api/v1/ai/chat", "AI01", "AI chat with delegated tools", "AiChatResult", { body: "AiChatInput", status: 200, roles: EVERY_USER });
create("/api/v1/ai/drafts", "AI01", "Create AI-assisted draft", "AiDraftResult", "AiDraftInput", WRITER, { idempotent: true, status: 201 });
detail("/api/v1/ai/tool-calls/{id}", "AI01", "Get redacted AI tool call", "AiToolCall");
create("/api/v1/core/records", "Core", "Create structured core record", "CoreRecordCreated", "CoreRecordCreate", ["administrator", "staff", "service"], { idempotent: true, description: "Kind-specific JSON Schema and writer policy apply. User-created evidence metadata gets its source key from the server." });
detail("/api/v1/core/records/{id}", "Core", "Get structured core record", "CoreRecord");
add("post", "/api/v1/files", "Core", "Upload quarantined file", "FileAccepted", { body: "FileUpload", multipart: true, status: 202, idempotent: true, roles: WRITER, description: "Only scanned clean files may be downloaded or shared." });
detail("/api/v1/files/{id}", "Core", "Get file metadata or content", "FileMetadata");

list("/api/v1/audit-logs", "Operations", "Query audit logs", "AuditEntry", ADMIN, ["action", "targetType", "targetId", "from", "to", "outcome"]);
list("/api/v1/reports/inventory-summary", "Operations", "Inventory summary", "InventorySummary", WRITER, ["warehouseId", "productId"]);
add("get", "/api/v1/reports/document-counts", "Operations", "Document counts", arr(ref("DocumentCount")), { query: ["from", "to", "type", "status"] });
list("/api/v1/reports/open-quality-signals", "Operations", "Open quality signals", "QualitySignal", ADMIN, ["severity"]);
list("/api/v1/quality/issues", "Operations", "List quality issues", "QualityIssue", ADMIN, ["state", "severity", "ruleId"]);
detail("/api/v1/quality/issues/{id}", "Operations", "Get quality issue", "QualityIssue", ADMIN);
action("/api/v1/quality/issues/{id}/acknowledge", "Operations", "Acknowledge quality issue", "QualityIssue", { body: "Reason", roles: ADMIN });
action("/api/v1/quality/issues/{id}/resolve", "Operations", "Resolve quality issue", "QualityIssue", { body: "Reason", roles: ADMIN });

const output = stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
if (process.argv.includes("--check")) {
  if (readFileSync(FILE, "utf8").replaceAll("\r\n", "\n") !== output) {
    console.error(`OpenAPI is stale; run node scripts/generate-openapi.mjs`);
    process.exit(1);
  }
  console.log(`OpenAPI in sync (${Object.keys(doc.paths).length} paths)`);
} else {
  writeFileSync(FILE, output);
  console.log(`Wrote ${FILE} (${Object.keys(doc.paths).length} paths)`);
}

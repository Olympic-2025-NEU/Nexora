// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { ref, schemas, schemaTools } from "./openapi-v1-schemas.mjs";

const { obj, arr, str, uuid } = schemaTools;
const FILE = "contracts/openapi/nexora-v1.yaml";
const EVERY_USER = [
  "administrator",
  "catalog_manager",
  "inventory_clerk",
  "sales_clerk",
  "stocktake_clerk",
  "issue_approver",
  "quality_officer",
  "auditor",
];
const ADMIN = ["administrator"];
const WRITER = ["administrator", "inventory_clerk", "catalog_manager", "sales_clerk", "stocktake_clerk"];
const APPROVER = ["issue_approver"];
const filterTypes = {
  cursor: str(), limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  depth: { type: "integer", minimum: 1, maximum: 10 },
  id: uuid, documentId: uuid, warehouseId: uuid, productId: uuid, batchId: uuid, partnerId: uuid, messageId: uuid,
  targetId: str({ maxLength: 128 }), requestId: str({ maxLength: 128 }),
  download: str({ enum: ["1"] }),
  from: str({ format: "date-time" }), to: str({ format: "date-time" }),
};

const doc = {
  openapi: "3.0.3",
  info: {
    title: "Nexora API",
    version: "1.0.0",
    description: "Nexora ERP API v1. P02-T07: Bearer security schemes (bearerUser, bearerM2M, oidc). Operations describe target behavior; runtime conformance tested per phase. See deploy/README.md for provisioning runbook.",
    license: { name: "AGPL-3.0-only", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
  },
  servers: [{ url: "https://{host}", variables: { host: { default: "nexora.example" } } }],
  tags: ["Platform", "Core", "M01", "M02", "M03", "M04", "AI01", "Operations"]
    .map((name) => ({ name, description: `${name} target contract` })),
  paths: {},
  components: {
    securitySchemes: {
      // P02-T07: Bearer security schemes.
      oidc: {
        type: "openIdConnect",
        openIdConnectUrl: "https://keycloak.example/.well-known/openid-configuration",
        description: "Authorization Code + PKCE. MFA required for administrator and issue_approver roles.",
      },
      bearerUser: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "User Bearer JWT. Audience: OIDC_AUDIENCE (erp-browser). Issued via auth-code+PKCE.",
      },
      bearerM2M: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Service-account Bearer JWT for M2M partner federation. Required scope: federation:write.",
      },
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
    if (name === "cursor" || name === "limit") {
      if (!options.list) params.push(pointer(name === "cursor" ? "Cursor" : "Limit"));
    } else params.push({ name, in: "query", schema: filterTypes[name] ?? str() });
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
    for (const mediaType of ["application/pdf", "image/png", "image/jpeg", "text/plain"]) {
      op.responses["200"].content[mediaType] = { schema: str({ format: "binary" }) };
    }
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
add("get", "/api/v1/me", "Platform", "Current actor", "Me", { raw: true });
detail("/api/v1/organization", "M01", "Get organization", "Organization");
patch("/api/v1/organization", "M01", "Update organization", "Organization", "OrganizationPatch", ADMIN);

list("/api/v1/members", "M01", "List members", "Member", ADMIN, ["status", "role"]);
create("/api/v1/members", "M01", "Create member", "Member", "MemberCreate", ADMIN);
patch("/api/v1/members/{id}", "M01", "Update member", "Member", "MemberPatch", ADMIN);
list("/api/v1/partners", "M01", "List partners", "Partner", EVERY_USER, ["status"]);
create("/api/v1/partners", "M01", "Create partner", "Partner", "PartnerCreate", ADMIN);
patch("/api/v1/partners/{id}", "M01", "Update partner", "Partner", "PartnerPatch", ADMIN);
add("get", "/api/v1/partners/{id}/connection", "M01", "Read partner connection metadata", "PartnerConnectionView", {
  roles: EVERY_USER,
  status: 200,
  description: "Returns safe connection view only (endpoint host, status, rotatedAt). outboundSecretRef is never included.",
  errors: [401, 403, 404, 429, 503],
});
add("put", "/api/v1/partners/{id}/connection", "M01", "Upsert partner connection", "PartnerConnectionView", { body: "PartnerConnectionInput", roles: ADMIN, status: 200, description: "Admin only; URLs must be HTTPS and SSRF-safe. Response never includes outboundSecretRef." });

list("/api/v1/products", "M02", "List products", "Product", EVERY_USER, ["q", "isActive", "categoryId"]);
create("/api/v1/products", "M02", "Create product", "Product", "ProductCreate");
detail("/api/v1/products/{id}", "M02", "Get product", "Product");
patch("/api/v1/products/{id}", "M02", "Update product", "Product", "ProductPatch");
list("/api/v1/products/{id}/variants", "M02", "List product variants", "ProductVariant", EVERY_USER);
create("/api/v1/products/{id}/variants", "M02", "Create product variant", "ProductVariant", "ProductVariantCreate");
patch("/api/v1/variants/{id}", "M02", "Update product variant", "ProductVariant", "ProductVariantPatch");
list("/api/v1/categories", "M02", "List categories", "Category", EVERY_USER);
create("/api/v1/categories", "M02", "Create category", "Category", "CategoryCreate");
list("/api/v1/uoms", "M02", "List UOMs", "Uom", EVERY_USER);
create("/api/v1/uoms", "M02", "Create UOM", "Uom", "UomCreate");
list("/api/v1/price-lists", "M02", "List price lists", "PriceList", EVERY_USER);
create("/api/v1/price-lists", "M02", "Create price list", "PriceList", "PriceListCreate");
list("/api/v1/price-lists/{id}/items", "M02", "List price list items", "PriceListItem", EVERY_USER);
create("/api/v1/price-lists/{id}/items", "M02", "Create price list item", "PriceListItem", "PriceListItemCreate");
list("/api/v1/batches", "M02", "List batches", "Batch", EVERY_USER, ["productId", "issuer", "expiresBefore", "status", "q"]);
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
add("get", "/api/v1/lots/{id}/issue-sources", "M03", "Available confirmed receipt sources",
  "IssueSourceAvailable", { list: true, roles: EVERY_USER, query: ["warehouseId"],
    errors: [401, 403, 404, 422, 429, 503],
    description: "Warehouse-scoped confirmed receipt/receiving lines with remaining declarable quantity in stock UOM. Draft issues do not reserve a source. Cursor pages default to 20 and cap at 100 source lines." });
doc.paths["/api/v1/lots/{id}/issue-sources"].get.parameters
  .find((parameter) => parameter.name === "warehouseId").required = true;
list("/api/v1/documents", "M03", "List documents", "Document", EVERY_USER, ["type", "status", "batchId", "partnerId", "from", "to"]);
add("get", "/api/v1/approvals/inbox", "M03", "List actionable approval tasks", "ApprovalTask", { roles: APPROVER, description: "Candidate-group tasks in current warehouse scope, excluding creator. Age reflects submission time." });
doc.paths["/api/v1/approvals/inbox"].get.responses["200"].content["application/json"].schema = envelope(arr(ref("ApprovalTask")));
add("post", "/api/v1/approvals/{id}/decisions", "M03", "Record approval decision intent", "ApprovalDecisionResult", { body: "ApprovalDecisionInput", roles: APPROVER, idempotent: true, ifMatch: true, status: 202, description: "Creator cannot decide own issue. Decision intent commits before Flowable completion; result is asynchronous. Clients must send If-Match / version from approvalVersion." });

add("get", "/api/v1/trace/status", "M04", "Local trace projector status", "TraceProjectorStatus", {
  description: "Authenticated local outbox lag. A caught-up queue does not assert that remote partner history is complete." });
add("get", "/api/v1/lots/{id}/history", "M04", "Lot history", "TraceHistory", { query: ["cursor", "limit"] });
add("post", "/api/v1/ot/readings", "Operations", "Ingest a simulated device reading", "OtReadingAccepted", {
  roles: WRITER, body: "OtReadingInput", status: 202, errors: [400, 401, 403, 404, 409, 413, 415, 422, 429, 503],
  description: "Authenticated demo simulator through the gateway. Device is scoped to this instance; the local batch must exist. Duplicate reading IDs with identical input are reused. Readings never change stock or lot quality.",
});
add("get", "/api/v1/lots/{id}/trace/backward", "M04", "Trace backward", "TraceGraph", {
  query: ["documentId", "depth", "cursor", "limit"],
  description: "Authenticated local backward graph. Only explicit confirmed source links imply causality. Same-batch events provide context; missing remote source, unknown local allocation and projector lag remain explicit gaps. Cursor freezes the recorded-at snapshot; depth counts source-link hops (1–10)." });
add("get", "/api/v1/lots/{id}/trace/forward", "M04", "Trace forward", "TraceGraph", {
  query: ["depth", "cursor", "limit"],
  description: "Authenticated local forward graph and per-document-line impact. Stored child-to-source links are traversed in reverse; sourceRelation preserves the original relationship. Confirmed local quantities are not additive across issue, transfer and sale. Partner downstream remains unknown until a verified report arrives in P09. No buyer reference or private partner contact is returned." });
add("post", "/api/v1/lots/{id}/federation-summary", "M04", "Queue allowlisted partner trace summary",
  "FederationSummaryQueued", { roles: ADMIN, scope: "organization-admin",
    body: "FederationSummaryPublishInput", status: 202,
    description: "Approved timeline policy limits direct sharing; only public remote assertions may be relayed. Queues an immutable outbox envelope and audits the recipient." });
add("post", "/api/v1/lots/{id}/downstream-impact", "M04", "Queue downstream impact",
  "FederationImpactQueued", { roles: ADMIN, scope: "organization-admin",
    body: "FederationImpactPublishInput", status: 202,
    description: "Confirmed sale or verified public inbound impact from a known receiver batch; queues C to B or B to A assertion without stock change or buyer PII." });
add("get", "/api/v1/lots/{id}/passport-policy", "M04", "Read passport policy", "PassportPolicyRead", {
  roles: ADMIN, scope: "organization-admin", description: "Owner administrator reads versioned policy and projection status; default is no public policy." });
add("post", "/api/v1/lots/{id}/passport-policy", "M04", "Draft passport policy", "PassportPolicyView", {
  roles: ADMIN, scope: "organization-admin", body: "PassportPolicyAccess",
  description: "Create the next private-by-default visibility policy version. A draft does not publish." });
add("post", "/api/v1/lots/{id}/passport-policy/approve", "M04", "Approve passport policy", "PassportPolicyApproved", {
  roles: ADMIN, scope: "organization-admin", body: "PassportPolicyVersion", status: 200,
  description: "Owner administrator approves one draft version and rebuilds the allowlisted projection atomically. Public projection is active only for an available batch with organization, product and batch visibility public." });
add("post", "/api/v1/lots/{id}/passport-policy/revoke", "M04", "Revoke passport policy", "PassportPolicyState", {
  roles: ADMIN, scope: "organization-admin", body: "Reason", status: 200,
  description: "Revoke approved policy and projection; public QR reading fails closed." });
add("post", "/api/v1/lots/{id}/passport-policy/rebuild", "M04", "Rebuild passport projection", "PassportPolicyState", {
  roles: ADMIN, scope: "organization-admin", status: 200,
  description: "Rebuild from confirmed trace source after stale event or quality change; never auto-publish restricted batches." });
action("/api/v1/lots/{id}/qr", "M04", "Issue QR token", "QrIssued", { body: "QrCreate", ifMatch: false, status: 201,
  description: "Administrator or unit-scoped staff issues a 256-bit opaque token for an active approved projection. Raw URL is returned once, expires in 30 days; repeating the Idempotency-Key returns 409." });
action("/api/v1/lots/{id}/qr/{tokenId}/revoke", "M04", "Revoke QR token", null, { body: "Reason", ifMatch: false, idempotent: false, status: 204,
  description: "Authenticated owner or unit-scoped staff revokes an issued token immediately and records an audit event." });
add("get", "/api/v1/lots/{id}/evidence", "M04", "List trace evidence", arr(ref("TraceEvidenceView")), {
  description: "Authenticated trace scope; lists checksum, visibility, scan state and source linkage only." });
add("post", "/api/v1/lots/{id}/evidence", "M04", "Attach clean trace evidence", "TraceEvidenceAttached", {
  body: "TraceEvidenceAttach", status: 201, roles: WRITER,
  description: "Bind a clean private-bucket attachment to a confirmed local trace event and document. Public visibility requires Administrator and approved public evidence/timeline policy; mutation marks projection stale." });
add("post", "/api/v1/lots/{id}/evidence/{evidenceId}/revoke", "M04", "Revoke trace evidence", null, {
  body: "Reason", status: 204, roles: WRITER,
  description: "Revoke evidence link and invalidate the active Passport projection; existing access URLs are denied immediately." });
add("get", "/api/v1/public/passport/{token}", "M04", "Public product passport", "PassportPublic", { auth: "public", errors: [404, 429, 503], description: "Only active, unexpired token, approved policy, available batch and verified allowlisted projection. Invalid, unknown and revoked are indistinguishable 404; no-store. Gateway rate limit 30 req/s, burst 15." });
doc.paths["/api/v1/public/passport/{token}"].get.parameters[0].schema =
  str({ pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43 });
add("get", "/api/v1/public/evidence/{token}", "M04", "Short-lived public evidence download", null, {
  auth: "public", errors: [404, 429, 503], description: "60-second application-signed capability issued only for clean public evidence. Core Data rechecks QR, policy, batch, projection, evidence and file state, then streams checksum-verified bytes with no-store." });
doc.paths["/api/v1/public/evidence/{token}"].get.parameters[0].schema =
  str({ pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43 });
doc.paths["/api/v1/public/evidence/{token}"].get.responses["200"] = {
  description: "Clean evidence bytes", content: Object.fromEntries(
    ["application/pdf", "image/png", "image/jpeg", "text/plain"].map((mime) =>
      [mime, { schema: str({ format: "binary" }) }])) };
add("post", "/api/v1/federation/events", "M04", "Accept federation event", "FederationAck", { auth: "m2m", body: "FederationEnvelope", raw: true, status: 202, errors: [401, 403, 409, 413, 422, 503], description: "Technical ACK after inbox commit; never confirms physical receiving or changes stock. Client ID and issuer must match partner mapping." });
list("/api/v1/federation/deliveries", "M04", "List outbound delivery status", "FederationDelivery", ADMIN, ["status", "partnerId"]);
action("/api/v1/federation/deliveries/{id}/retry", "M04", "Retry outbound delivery", "FederationRetryResult", { body: "Reason", roles: ADMIN, status: 202, ifMatch: false });

add("post", "/api/v1/ai/chat", "AI01", "Lot lookup Q&A with sourced facts", "AiChatResult", { body: "AiChatInput", status: 200, roles: EVERY_USER, description: "Deterministic facts with optional connector text. No confirm tools." });
add("post", "/api/v1/ai/draft", "AI01", "Propose receipt draft fields", "AiDraftProposeResult", { body: "AiDraftProposeInput", status: 200, roles: WRITER, description: "Proposal only; does not create a trading document or change stock." });
add("post", "/api/v1/ai/draft/create", "AI01", "Create receipt draft from reviewed proposal", "AiDraftCreateResult", { body: "AiDraftCreateInput", status: 200, roles: WRITER, description: "Creates M03 draft after human review; never confirms stock." });
add("post", "/api/v1/ai/risk/feedback", "AI01", "Record risk alert feedback", "AiRiskFeedbackResult", { body: "AiRiskFeedbackInput", status: 200, roles: EVERY_USER, description: "Audit-only feedback; does not change stock or approvals." });
create("/api/v1/core/records", "Core", "Create private evidence record", "CoreRecord", "CoreRecordCreate", WRITER, { idempotent: true, errors: [401, 403, 404, 409, 422, 503], description: "Only evidence_metadata with an authorized active membership or organization owner and clean private attachment. Server assigns source key, visibility and policy version. Same Idempotency-Key and payload returns 200; different payload returns 409 unless If-Match names the current version and owner remains unchanged." });
doc.paths["/api/v1/core/records"].post.responses["200"] = doc.paths["/api/v1/core/records"].post.responses["201"];
doc.paths["/api/v1/core/records"].post.parameters.push({ name: "If-Match", in: "header", required: false,
  schema: str({ pattern: '^"[1-9][0-9]*"$' }), description: "Optional current version for a change to existing evidence." });
detail("/api/v1/core/records/{id}", "Core", "Get structured core record", "CoreRecord");
add("post", "/api/v1/files", "Core", "Upload quarantined file", "FileAccepted", { body: "FileUpload", multipart: true, status: 202, idempotent: true, roles: WRITER, description: "Only scanned clean files may be downloaded or shared." });
add("get", "/api/v1/files/{id}", "Core", "Get file metadata or content", "FileMetadata", {
  roles: EVERY_USER, query: ["download"], errors: [400, 401, 403, 404, 423, 429, 503],
  description: "Returns metadata by default. download=1 streams bytes only after a clean scan and resource authorization.",
});
add("post", "/api/v1/files/{id}/retry-scan", "Core", "Retry failed file scan", "FileScanRetry", {
  status: 202, roles: ADMIN, errors: [400, 401, 403, 404, 409, 429, 503],
  description: "Administrator only. Resets an error state to pending; infected files cannot be retried or released. Empty request body.",
});
add("post", "/api/v1/files/{id}/discard", "Core", "Discard infected quarantine bytes", "FileDiscarded", {
  status: 202, roles: ADMIN, errors: [400, 401, 403, 404, 409, 429, 503],
  description: "Administrator only. Deletes infected quarantine bytes, retains metadata and audit, and never releases the file. Repeated requests are safe. Empty request body.",
});

add("get", "/api/v1/audit-logs", "Operations", "Query audit logs", "AuditEntry", {
  list: true, roles: ADMIN,
  query: ["action", "targetType", "targetId", "requestId", "from", "to", "outcome"],
  errors: [400, 401, 403, 429, 503],
  description: "Administrator-only audit query. Filters are allowlisted and summaries are never returned.",
});
add("get", "/api/v1/admin/retries", "Operations", "List dead letters and halted approvals",
  "OpsRetriesView", { roles: ADMIN, raw: true, errors: [401, 403, 429, 503],
    description: "Administrator-only redacted operations list; no payload or token." });
add("post", "/api/v1/admin/retries", "Operations", "Retry one dead-letter outbox message",
  "OpsRetryResult", { roles: ADMIN, raw: true, body: "OpsRetryInput", status: 202,
    errors: [400, 401, 403, 404, 409, 429, 503],
    description: "Only dead_letter may be reset; immutable envelope is retried and action audited." });
add("get", "/api/v1/admin/federation/operations", "Operations", "Inspect local federation operations",
  "OpsFederationView", { roles: ADMIN, raw: true, query: ["messageId"],
    errors: [400, 401, 403, 429, 503],
    description: "Find sender outbox/attempts or receiver inbox by envelope message ID. Redacted response, no payload, no-store." });
add("post", "/api/v1/admin/federation/operations", "Operations", "Reprocess one pending federation inbox",
  "OpsReprocessResult", { roles: ADMIN, raw: true, body: "OpsReprocessInput", status: 202,
    errors: [400, 401, 403, 404, 409, 429, 503],
    description: "Re-evaluate one pending_dependency row under lock and audit state before/after." });
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

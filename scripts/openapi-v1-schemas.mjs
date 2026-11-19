// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";

export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties, required = [], extra = {}) => ({
  type: "object", additionalProperties: false,
  ...(required.length ? { required } : {}),
  properties, ...extra,
});
const arr = (items, extra = {}) => ({ type: "array", items, ...extra });
const str = (extra = {}) => ({ type: "string", ...extra });
const enumeration = (...values) => str({ enum: values });
const uuid = str({ format: "uuid" });
const time = str({ format: "date-time" });
const day = str({ format: "date" });
const integer = { type: "integer", minimum: 1 };
const positive = str({ pattern: "^(?!0(?:\\.0{1,3})?$)(0|[1-9][0-9]*)(\\.[0-9]{1,3})?$" });
const nonNegative = str({ pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,3})?$" });
const signed = str({ pattern: "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,3})?$" });
const unit = enumeration("EA", "KG", "L");
const status = enumeration("draft", "pending_approval", "approved", "rejected", "confirmed", "cancelled");

function jsonSchemaAsOpenApi(file) {
  const source = JSON.parse(readFileSync(file, "utf8"));
  const convert = (value) => {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$schema" || key === "$id" || key === "if" || key === "then" || key === "else") continue;
      if (key === "allOf" && file.includes("envelope-v1.schema.json")) continue;
      if (key === "const") result.enum = [child];
      else result[key] = convert(child);
    }
    return result;
  };
  const schema = convert(source);
  if (file.includes("envelope-v1.schema.json")) {
    schema.description = "Cross-field event rules are enforced by contracts/events/envelope-v1.schema.json.";
  }
  return schema;
}

export const schemas = {
  ErrorBody: obj({
    code: str(), message: str(), requestId: str(),
    details: arr(obj({ field: str(), reason: str() }, ["field", "reason"])),
  }, ["code", "message", "requestId"]),
  HealthStatus: obj({ status: enumeration("ok", "degraded"), service: str(), version: str() }, ["status", "service", "version"]),
  Page: obj({ nextCursor: str(), limit: { type: "integer", minimum: 1, maximum: 100 } }, ["limit"]),
  Me: obj({ sub: str(), displayName: str(), role: enumeration("administrator", "staff", "approver", "viewer"), status: str(), warehouseIds: arr(uuid) }, ["sub", "displayName", "role", "status", "warehouseIds"]),
  Organization: obj({ id: uuid, instanceId: str(), code: str(), name: str(), timezone: str(), status: str(), version: integer, contactEmail: str({ format: "email" }) }, ["id", "instanceId", "code", "name", "timezone", "status", "version"]),
  OrganizationPatch: obj({ name: str({ minLength: 1 }), contactEmail: str({ format: "email" }), timezone: str() }, [], { minProperties: 1 }),
  Member: obj({ id: uuid, keycloakSub: str(), displayName: str(), email: str({ format: "email" }), role: enumeration("administrator", "staff", "approver", "viewer"), status: str(), warehouseIds: arr(uuid), version: integer }, ["id", "keycloakSub", "displayName", "role", "status", "version"]),
  MemberCreate: obj({ keycloakSub: str({ minLength: 1 }), displayName: str({ minLength: 1 }), email: str({ format: "email" }), role: enumeration("administrator", "staff", "approver", "viewer"), warehouseIds: arr(uuid) }, ["keycloakSub", "displayName", "role"]),
  MemberPatch: obj({ role: enumeration("administrator", "staff", "approver", "viewer"), status: enumeration("active", "disabled"), warehouseIds: arr(uuid) }, [], { minProperties: 1 }),
  Partner: obj({ id: uuid, issuerInstanceId: str(), code: str(), displayName: str(), contactEmail: str({ format: "email" }), status: str(), connectionStatus: str(), version: integer }, ["id", "issuerInstanceId", "code", "displayName", "status", "version"]),
  PartnerCreate: obj({ issuerInstanceId: str({ minLength: 1 }), code: str({ minLength: 1 }), displayName: str({ minLength: 1 }), contactEmail: str({ format: "email" }) }, ["issuerInstanceId", "code", "displayName"]),
  PartnerPatch: obj({ displayName: str({ minLength: 1 }), status: enumeration("active", "suspended"), contactEmail: str({ format: "email" }) }, [], { minProperties: 1 }),
  PartnerConnectionInput: obj({ endpointUrl: str({ format: "uri", pattern: "^https://" }), outboundTokenUrl: str({ format: "uri", pattern: "^https://" }), outboundClientId: str(), outboundSecretRef: str(), outboundAudience: str(), inboundClientId: str(), allowedInboundScope: str() }, ["endpointUrl", "outboundTokenUrl", "outboundClientId", "outboundSecretRef", "outboundAudience", "inboundClientId", "allowedInboundScope"]),
  PartnerConnectionView: obj({ partnerId: uuid, endpointHost: str(), status: str(), rotatedAt: time }, ["partnerId", "endpointHost", "status"]),
  Product: obj({ id: uuid, sku: str(), name: str(), description: str(), baseUnit: unit, status: str(), version: integer }, ["id", "sku", "name", "baseUnit", "status", "version"]),
  ProductCreate: obj({ sku: str({ minLength: 1 }), name: str({ minLength: 1 }), description: str(), baseUnit: unit }, ["sku", "name", "baseUnit"]),
  ProductPatch: obj({ name: str({ minLength: 1 }), description: str(), status: enumeration("active", "archived") }, [], { minProperties: 1 }),
  ProductIdentifier: obj({ id: uuid, productId: uuid, kind: enumeration("ean13", "internal_barcode"), value: str(), isPrimary: { type: "boolean" } }, ["id", "productId", "kind", "value"]),
  ProductIdentifierCreate: obj({ kind: enumeration("ean13", "internal_barcode"), value: str({ minLength: 1 }), isPrimary: { type: "boolean" } }, ["kind", "value"]),
  OriginLot: obj({ issuerInstanceId: str(), lotId: uuid }, ["issuerInstanceId", "lotId"]),
  Batch: obj({ id: uuid, productId: uuid, localCode: str(), originLot: ref("OriginLot"), qualityStatus: enumeration("inspect", "available", "restricted"), manufacturedOn: day, expiresOn: day, version: integer }, ["id", "productId", "localCode", "originLot", "qualityStatus", "version"]),
  BatchCreate: obj({ productId: uuid, localCode: str({ minLength: 1 }), manufacturedOn: day, expiresOn: day }, ["productId", "localCode"]),
  BatchQualityAction: obj({ action: enumeration("mark_available", "restrict", "inspect"), reason: str({ minLength: 1 }) }, ["action", "reason"]),
  Warehouse: obj({ id: uuid, code: str(), name: str(), status: str(), version: integer }, ["id", "code", "name", "status", "version"]),
  WarehouseCreate: obj({ code: str({ minLength: 1 }), name: str({ minLength: 1 }) }, ["code", "name"]),
  StockBalance: obj({ warehouseId: uuid, productId: uuid, batchId: uuid, quantity: nonNegative, unit, updatedAt: time }, ["warehouseId", "productId", "batchId", "quantity", "unit", "updatedAt"]),
  StockMovement: obj({ id: uuid, kind: str(), delta: signed, balanceAfter: nonNegative, sourceDocumentId: uuid, createdAt: time }, ["id", "kind", "delta", "balanceAfter", "sourceDocumentId", "createdAt"]),
  QuantityLine: obj({ warehouseId: uuid, productId: uuid, batchId: uuid, quantity: positive, unit }, ["warehouseId", "productId", "batchId", "quantity", "unit"]),
  CountLine: obj({ warehouseId: uuid, productId: uuid, batchId: uuid, countedQuantity: nonNegative, unit }, ["warehouseId", "productId", "batchId", "countedQuantity", "unit"]),
  ActualLine: obj({ sourceLineId: uuid, localBatchId: uuid, warehouseId: uuid, actualQuantity: nonNegative, unit }, ["sourceLineId", "localBatchId", "warehouseId", "actualQuantity", "unit"]),
  DocumentLine: obj({ id: uuid, warehouseId: uuid, productId: uuid, batchId: uuid, quantity: nonNegative, actualQuantity: nonNegative, countedQuantity: nonNegative, unit, sourceLineRef: uuid }, ["id", "warehouseId", "productId", "batchId", "unit"]),
  Document: obj({ id: uuid, documentType: enumeration("goods_receipt", "goods_issue", "partner_transfer", "receiving_confirmation", "stocktake", "sale_record"), documentNumber: str(), status, version: integer, lines: arr(ref("DocumentLine")), confirmedAt: time, movementIds: arr(uuid), linkedIssueId: uuid }, ["id", "documentType", "documentNumber", "status", "version", "lines"]),
  NonStockDocument: obj({ id: uuid, documentType: enumeration("partner_transfer", "sale_record"), documentNumber: str(), status, version: integer, lines: arr(ref("DocumentLine")), confirmedAt: time, movementIds: arr(uuid, { maxItems: 0 }), linkedIssueId: uuid }, ["id", "documentType", "documentNumber", "status", "version", "lines", "movementIds"]),
  ReceiptCreate: obj({ lines: arr(ref("QuantityLine"), { minItems: 1 }), note: str(), correctionOfDocumentId: uuid, correctionReason: str() }, ["lines"]),
  IssueCreate: obj({ purpose: enumeration("partner_transfer", "sale", "other"), lines: arr(ref("QuantityLine"), { minItems: 1 }), note: str(), correctionOfDocumentId: uuid, correctionReason: str() }, ["purpose", "lines"]),
  TransferCreate: obj({ linkedIssueId: uuid, destinationPartnerId: uuid, note: str() }, ["linkedIssueId", "destinationPartnerId"]),
  ReceivingCreate: obj({ inboundMessageId: uuid, actualLines: arr(ref("ActualLine"), { minItems: 1 }), discrepancyReason: str() }, ["inboundMessageId", "actualLines"]),
  StocktakeCreate: obj({ lines: arr(ref("CountLine"), { minItems: 1 }), note: str({ minLength: 1 }), correctionOfDocumentId: uuid, correctionReason: str() }, ["lines", "note"]),
  SaleCreate: obj({ linkedIssueId: uuid, buyerRef: str(), soldAt: time }, ["linkedIssueId"]),
  ReceiptPatch: obj({ lines: arr(ref("QuantityLine"), { minItems: 1 }), note: str() }, [], { minProperties: 1 }),
  IssuePatch: obj({ lines: arr(ref("QuantityLine"), { minItems: 1 }), note: str() }, [], { minProperties: 1 }),
  ReceivingPatch: obj({ actualLines: arr(ref("ActualLine"), { minItems: 1 }), discrepancyReason: str() }, [], { minProperties: 1 }),
  StocktakePatch: obj({ lines: arr(ref("CountLine"), { minItems: 1 }), note: str() }, [], { minProperties: 1 }),
  ApprovalTask: obj({ approvalRequestId: uuid, approvalVersion: integer, documentId: uuid, taskId: str(), creatorSub: str(), submittedAt: time, state: str() }, ["approvalRequestId", "approvalVersion", "documentId", "taskId", "creatorSub", "submittedAt", "state"]),
  ApprovalDecisionInput: obj({ decision: enumeration("approved", "rejected"), reason: str() }, ["decision"]),
  ApprovalDecisionResult: obj({ approvalRequestId: uuid, state: enumeration("decision_pending") }, ["approvalRequestId", "state"]),
  TraceHistory: obj({ lot: ref("Batch"), events: arr(obj({ eventId: uuid, type: str(), issuer: str(), occurredAt: time, sourceDocumentId: uuid, verificationState: str(), gap: { type: "boolean" } }, ["eventId", "type", "issuer", "occurredAt", "verificationState"])), nextCursor: str() }, ["lot", "events"]),
  TraceGraph: obj({ nodes: arr(obj({ issuer: str(), lotId: uuid, eventId: uuid, state: str() }, ["issuer", "lotId", "eventId", "state"])), edges: arr(obj({ from: uuid, to: uuid, relation: str() }, ["from", "relation"])), gaps: arr(str()), asOf: time }, ["nodes", "edges", "gaps", "asOf"]),
  QrCreate: obj({ policyVersion: str({ minLength: 1 }) }, ["policyVersion"]),
  QrIssued: obj({ qrUrl: str({ format: "uri" }), tokenId: uuid }, ["qrUrl", "tokenId"]),
  Reason: obj({ reason: str({ minLength: 1 }) }, ["reason"]),
  PassportPublic: obj({ productName: str(), publicLotCode: str(), originIssuer: str(), timeline: arr(obj({ type: str(), occurredAt: time, verificationState: str() }, ["type", "occurredAt", "verificationState"])), verificationState: str(), gaps: arr(str()), asOf: time }, ["productName", "publicLotCode", "originIssuer", "timeline", "verificationState", "gaps", "asOf"]),
  FederationAck: obj({ messageId: uuid, ackId: uuid, acceptedAt: time, status: enumeration("validated", "pending_dependency") }, ["messageId", "ackId", "acceptedAt", "status"]),
  FederationDelivery: obj({ id: uuid, messageId: uuid, status: str(), attemptCount: { type: "integer", minimum: 0 }, nextAttemptAt: time, lastErrorCode: str() }, ["id", "messageId", "status", "attemptCount"]),
  FederationRetryResult: obj({ id: uuid, status: enumeration("retry_due") }, ["id", "status"]),
  AiChatInput: obj({ message: str({ minLength: 1 }), conversationId: uuid, lotRef: str() }, ["message"]),
  AiChatResult: obj({ answer: str(), sources: arr(obj({ type: str(), id: str(), verificationState: str(), asOf: time }, ["type", "id", "verificationState"])), toolCallIds: arr(uuid), needsClarification: { type: "boolean" } }, ["answer", "sources", "toolCallIds", "needsClarification"]),
  AiDraftInput: obj({ documentType: enumeration("goods_receipt", "goods_issue"), instruction: str({ minLength: 1 }), purpose: enumeration("partner_transfer", "sale", "other"), proposedFields: { type: "object" } }, ["documentType", "instruction"]),
  AiDraftResult: obj({ draftDocumentId: uuid, status: enumeration("draft"), proposedFields: { type: "object" }, sources: arr(str()), warnings: arr(str()) }, ["draftDocumentId", "status", "proposedFields", "sources", "warnings"]),
  AiToolCall: obj({ id: uuid, toolName: str(), actorSub: str(), sourceIds: arr(str()), outcome: str() }, ["id", "toolName", "actorSub", "outcome"]),
  CoreRecordCreate: obj({ kind: enumeration("evidence_metadata"), payload: ref("EvidenceMetadataPayload") }, ["kind", "payload"]),
  CoreRecord: obj({ id: uuid, kind: str(), version: integer, checksum: str({ pattern: "^[0-9a-f]{64}$" }), builtAt: time, visibility: enumeration("private"), payload: ref("EvidenceMetadataPayload") }, ["id", "kind", "version", "checksum", "builtAt", "visibility", "payload"]),
  CoreRecordCreated: obj({ id: uuid, version: integer, checksum: str({ pattern: "^[0-9a-f]{64}$" }), builtAt: time }, ["id", "version", "checksum", "builtAt"]),
  FileUpload: obj({ file: str({ format: "binary" }), ownerType: enumeration("document", "batch", "trace_event", "core_record"), ownerId: uuid, visibility: enumeration("private", "partner", "public") }, ["file"]),
  FileMetadata: obj({ id: uuid, mimeType: str(), sizeBytes: { type: "integer", minimum: 1 }, scanState: enumeration("pending", "clean", "infected", "error"), visibility: str(), checksum: str({ pattern: "^[0-9a-f]{64}$" }), scanAttempts: { type: "integer", minimum: 0, maximum: 5 }, scanErrorCode: str({ nullable: true }), nextScanAt: str({ format: "date-time", nullable: true }), quarantinePurgedAt: str({ format: "date-time", nullable: true }) }, ["id", "mimeType", "sizeBytes", "scanState", "visibility", "checksum"]),
  FileAccepted: obj({ id: uuid, scanState: enumeration("pending", "clean", "infected", "error") }, ["id", "scanState"]),
  FileScanRetry: obj({ id: uuid, scanState: enumeration("pending") }, ["id", "scanState"]),
  FileDiscarded: obj({ id: uuid, scanState: enumeration("infected"), discarded: { type: "boolean", enum: [true] } }, ["id", "scanState", "discarded"]),
  AuditEntry: obj({ id: uuid, createdAt: time, actorSub: str(), clientId: str(), action: str(), targetType: str(), targetId: str(), outcome: str(), requestId: str(), correlationId: str() }, ["id", "createdAt", "action", "targetType", "targetId", "outcome", "requestId"]),
  InventorySummary: obj({ warehouseId: uuid, productId: uuid, batchId: uuid, quantity: nonNegative, unit }, ["warehouseId", "productId", "batchId", "quantity", "unit"]),
  DocumentCount: obj({ documentType: str(), status: str(), count: { type: "integer", minimum: 0 } }, ["documentType", "status", "count"]),
  QualityIssue: obj({ id: uuid, ruleId: str(), sourceType: str(), sourceId: str(), state: enumeration("open", "acknowledged", "resolved"), severity: enumeration("info", "warning", "critical"), firstDetectedAt: time, lastDetectedAt: time, version: integer, sourceEventIds: arr(uuid), detail: { type: "object" } }, ["id", "ruleId", "sourceType", "sourceId", "state", "severity", "firstDetectedAt", "lastDetectedAt", "version"]),
  QualitySignal: obj({ id: uuid, ruleId: str(), sourceType: str(), sourceId: str(), severity: str(), state: str(), lastDetectedAt: time }, ["id", "ruleId", "sourceType", "sourceId", "severity", "state", "lastDetectedAt"]),
  EvidenceMetadataPayload: jsonSchemaAsOpenApi("contracts/core-records/evidence_metadata.schema.json"),
  TraceProjectionPayload: jsonSchemaAsOpenApi("contracts/core-records/trace_projection.schema.json"),
  OtReadingPayload: jsonSchemaAsOpenApi("contracts/core-records/ot_reading.schema.json"),
  ArchiveManifestPayload: jsonSchemaAsOpenApi("contracts/core-records/archive_manifest.schema.json"),
  FederationEnvelope: jsonSchemaAsOpenApi("contracts/events/envelope-v1.schema.json"),
};

export const schemaTools = { obj, arr, str, enumeration, uuid, time, positive, nonNegative };

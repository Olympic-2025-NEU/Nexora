// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { checkPolicy } from "@/platform/access/policy";
import type { Actor } from "@/platform/identity/actor";
import { DomainError } from "@/platform/kernel/errors";
import type { ToolContext } from "./ports";
import {
  buildFactBundle,
  extractIssuers,
  extractLotCodes,
  sanitizePartnerText,
  type ChatFact,
  type LotCandidate,
  type ToolRun,
} from "./chat-lot-lookup";

type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_TEXT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const WAREHOUSE_CODE_RE = /(?<![\p{L}\d])WH[-_]?[A-Z0-9]+(?:[-_][A-Z0-9]+)*(?![\p{L}\d])/giu;
const WAREHOUSE_PHRASE_RE = /(?:[Kk][Hh][Oo]|[Ww][Aa][Rr][Ee][Hh][Oo][Uu][Ss][Ee])\s*(?:mã\s*)?[:=]?\s*([A-Z][A-Z0-9._-]{0,39})(?![\p{L}\d])/u;
const QUANTITY_PHRASE_RE = /(?<![\p{L}\d])(?:số\s*lượng|nhập\s*kho|nhập|vào\s*kho|qty|sl)\s*[:=]?\s*(\d+(?:[.,]\d{1,3})?)(?!\d)/iu;
const QUANTITY_TOKEN_RE = /(?<![\d\p{L}])\d+(?:[.,]\d{1,3})?(?![\d\p{L}])/u;
const PROPOSAL_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const UNIT_ALIASES: Record<string, string> = {
  EA: "EA", KG: "KG", KILOGRAM: "KG", KILOGAM: "KG", KILÔGRAM: "KG",
  G: "G", GRAM: "G", L: "L", LIT: "L", LÍT: "L", ML: "ML",
  T: "T", TAN: "T", TẤN: "T", CARTON: "CARTON", BOX: "BOX", PALLET: "PALLET",
  HOP: "HOP", HỘP: "HOP", THUNG: "THUNG", THÙNG: "THUNG",
  CAI: "CAI", CÁI: "CAI", CHIEC: "CAI", CHIẾC: "CAI",
};

function normalizeUnitKey(value: string): string {
  return value.toLocaleUpperCase("vi").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const UNIT_LOOKUP = new Map(Object.entries(UNIT_ALIASES)
  .map(([alias, code]) => [normalizeUnitKey(alias), code]));
const UNIT_TOKEN_RE = new RegExp(`(?<![\\p{L}])(?:${Object.keys(UNIT_ALIASES)
  .sort((left, right) => right.length - left.length).join("|")})(?![\\p{L}])`, "giu");

export type DraftFields = {
  warehouseId: string;
  batchId: string;
  quantity: string;
  unit: string;
};

export type DraftExtraction = {
  request: string;
  lotCodes: string[];
  issuerHints: string[];
  batchIds: string[];
  quantity: string;
  unit: string;
  warehouseHint: string;
};

export type DraftWarningCode =
  | "quality_not_available"
  | "origin_partner_asserted"
  | "quantity_abnormal"
  | "trace_gap";

export type DraftWarning = {
  code: DraftWarningCode;
  message: string;
  sourceId?: string;
};

export type DraftProposalResponse =
  | { status: "empty"; fields: DraftFields; sources: ChatFact[]; warnings: DraftWarning[];
      proposalId: null; hint: string; requestId: string }
  | { status: "ambiguous"; candidates: LotCandidate[]; requestId: string }
  | { status: "incomplete"; fields: DraftFields; sources: ChatFact[]; warnings: DraftWarning[];
      requestId: string }
  | { status: "proposed"; fields: DraftFields; sources: ChatFact[]; warnings: DraftWarning[];
      proposalId: string; requestId: string };

export type DraftCreated = {
  status: "created";
  proposalId: string;
  draftDocumentId: string;
  fields: DraftFields;
  sourceIds: string[];
};

export type DraftAuditEntry = {
  actor: Actor;
  action: "ai.draft.proposed" | "ai.draft.created";
  targetType: "ai_draft_proposal" | "ai_draft";
  targetId: string;
  requestId: string;
  after: Record<string, unknown>;
};

export type DraftAuditPort = { record(entry: DraftAuditEntry): Promise<void> };

export type DraftWarehouse = { id: string; code?: string; name?: string };

export type DraftDependencies = {
  actor: Actor;
  authorization: string;
  requestId: string;
  runTool: ToolRun;
  allowedIssuers?: readonly string[];
  warehouses?: readonly DraftWarehouse[];
  auditDraft?: DraftAuditPort;
  now?: () => Date;
};

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function emptyFields(): DraftFields {
  return { warehouseId: "", batchId: "", quantity: "", unit: "" };
}

function requireRequestId(value: string): string {
  if (!REQUEST_ID_RE.test(value)) throw new DomainError("AI_DRAFT_REQUEST_INVALID", 400);
  return value;
}

function normalizeQuantity(value: string): string {
  const match = value.trim().replace(",", ".").match(/^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/);
  if (!match || match[1]!.length > 15) return "";
  return `${BigInt(match[1]!)}.${(match[2] ?? "").padEnd(3, "0")}`;
}

function canonicalUnit(value: string): string {
  return UNIT_LOOKUP.get(normalizeUnitKey(sanitizePartnerText(value, 20))) ?? "";
}

function scaled(value: string): bigint | null {
  const match = value.match(/^(\d{1,15})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  return BigInt(match[1]!) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(3, "0"));
}

export function extractDraftRequest(value: string): DraftExtraction {
  const request = sanitizePartnerText(value, 300);
  const warehouseCode = request.match(WAREHOUSE_CODE_RE)?.[0]?.toLocaleUpperCase("vi") ?? "";
  const lotCodes = extractLotCodes(request).filter((code) => code !== warehouseCode);
  const issuerHints = extractIssuers(request);
  const batchIds = request.match(UUID_TEXT_RE) ?? [];
  const withoutIds = lotCodes.reduce((source, code) => source.split(code).join(" "), request)
    .replace(UUID_TEXT_RE, " ").split(warehouseCode || "\u0000").join(" ");
  const quantityRaw = withoutIds.match(QUANTITY_PHRASE_RE)?.[1] ??
    withoutIds.match(QUANTITY_TOKEN_RE)?.[0] ?? "";
  const unitMatch = withoutIds.match(UNIT_TOKEN_RE)?.[0] ?? "";
  const warehouseUuid = batchIds.length > 1 ? batchIds[1]! : "";
  const phrase = request.match(WAREHOUSE_PHRASE_RE)?.[1] ?? "";
  const warehouseHint = warehouseUuid || warehouseCode ||
    (phrase && !lotCodes.some((code) => code.toLocaleUpperCase("vi") === phrase.toLocaleUpperCase("vi"))
      ? sanitizePartnerText(phrase, 40) : "");
  return { request, lotCodes, issuerHints, batchIds,
    quantity: normalizeQuantity(quantityRaw), unit: canonicalUnit(unitMatch), warehouseHint };
}

export function pickDraftFields(input: unknown): Partial<DraftFields> {
  const source = row(input);
  const fields: Partial<DraftFields> = {};
  if (UUID_RE.test(text(source.warehouseId))) fields.warehouseId = text(source.warehouseId);
  if (UUID_RE.test(text(source.batchId))) fields.batchId = text(source.batchId);
  const quantity = normalizeQuantity(text(source.quantity));
  if (quantity) fields.quantity = quantity;
  const unit = canonicalUnit(text(source.unit));
  if (unit) fields.unit = unit;
  return fields;
}

function parseProposalInput(input: unknown): {
  request: string;
  batchId?: string;
  lotCode?: string;
  issuer?: string;
  fields?: Partial<DraftFields>;
} {
  const body = row(input);
  const fields = pickDraftFields(body.fields);
  const request = typeof body.request === "string" ? sanitizePartnerText(body.request, 300)
    : typeof body.question === "string" ? sanitizePartnerText(body.question, 300) : "";
  return {
    request,
    ...(UUID_RE.test(text(body.batchId)) ? { batchId: text(body.batchId) } : {}),
    ...(typeof body.lotCode === "string" ? { lotCode: sanitizePartnerText(body.lotCode, 100) } : {}),
    ...(typeof body.issuer === "string" ? { issuer: sanitizePartnerText(body.issuer, 80) } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
}

export function parseDraftCreateInput(input: unknown): { proposalId: string; fields: DraftFields; note?: string } {
  const body = row(input);
  const proposalId = text(body.proposalId);
  if (!PROPOSAL_ID_RE.test(proposalId)) throw new DomainError("AI_DRAFT_PROPOSAL_INVALID", 422);
  const fields = pickDraftFields(body.fields);
  if (!fields.warehouseId || !fields.batchId || !fields.quantity || !fields.unit) {
    throw new DomainError("AI_DRAFT_FIELDS_INVALID", 422);
  }
  const note = typeof body.note === "string" ? sanitizePartnerText(body.note, 200) : "";
  return {
    proposalId,
    fields: { warehouseId: fields.warehouseId, batchId: fields.batchId,
      quantity: fields.quantity, unit: fields.unit },
    ...(note ? { note } : {}),
  };
}

export function draftProposalId(actorId: string, fields: DraftFields, requestId: string): string {
  requireRequestId(requestId);
  if (!actorId) throw new DomainError("AI_DRAFT_ACTOR_INVALID", 422);
  const canonical = canonicalize({
    actorId,
    fields: { warehouseId: fields.warehouseId, batchId: fields.batchId,
      quantity: fields.quantity, unit: fields.unit },
    requestId,
  });
  if (!canonical) throw new DomainError("AI_DRAFT_FIELDS_INVALID", 422);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function toolContext(deps: DraftDependencies, idempotencyKey?: string): ToolContext {
  return { actor: deps.actor, authorization: deps.authorization, requestId: deps.requestId,
    ...(idempotencyKey ? { idempotencyKey } : {}), now: deps.now };
}

function visible(candidate: LotCandidate, deps: DraftDependencies): boolean {
  return !deps.allowedIssuers || deps.allowedIssuers.includes(candidate.issuer) ||
    candidate.issuer === deps.actor.organizationId;
}

function candidateFrom(lot: Row): LotCandidate | null {
  const origin = row(lot.originLot);
  const product = row(lot.product);
  const batchId = text(lot.batchId);
  if (!UUID_RE.test(batchId)) return null;
  return { batchId, lotCode: sanitizePartnerText(text(origin.lotId), 100),
    issuer: sanitizePartnerText(text(origin.issuerInstanceId), 80),
    productName: sanitizePartnerText(text(product.name), 100), sourceId: batchId };
}

type DraftResolution = {
  status: "not_found" | "ambiguous" | "resolved";
  candidates: LotCandidate[];
  lot?: Row;
};

async function resolveDraftLot(input: {
  batchId?: string;
  lotCode?: string;
  issuer?: string;
}, extraction: DraftExtraction, deps: DraftDependencies): Promise<DraftResolution> {
  if (!checkPolicy(deps.actor, "catalog:batch:read").allowed) throw new DomainError("POLICY_DENIED", 403);
  const ctx = toolContext(deps);
  const call = async (payload: Row): Promise<Row> => row(await deps.runTool("getLot", payload, ctx));
  const found: { candidate: LotCandidate; lot: Row }[] = [];
  const batchId = input.batchId ?? extraction.batchIds[0] ?? "";
  if (batchId) {
    const lot = await call({ batchId });
    const candidate = candidateFrom(lot);
    if (candidate && visible(candidate, deps)) found.push({ candidate, lot });
  } else {
    const codes = input.lotCode ? [input.lotCode] : extraction.lotCodes;
    const issuers = input.issuer ? [input.issuer] : extraction.issuerHints.length
      ? extraction.issuerHints : deps.allowedIssuers ?? [];
    if (!codes.length || !issuers.length) return { status: "not_found", candidates: [] };
    for (const code of codes) {
      for (const issuer of issuers) {
        try {
          const lot = await call({ originIssuerId: issuer, originLotId: code });
          const candidate = candidateFrom(lot);
          if (candidate && visible(candidate, deps)) found.push({ candidate, lot });
        } catch (error) {
          if (error instanceof DomainError &&
              ["AI_LOT_NOT_FOUND", "AI_LOT_AMBIGUOUS", "AI_LOT_LOOKUP_TRUNCATED"].includes(error.code)) continue;
          throw error;
        }
      }
    }
  }
  const unique = [...new Map(found.map((entry) => [entry.candidate.batchId, entry])).values()];
  if (!unique.length) return { status: "not_found", candidates: [] };
  if (unique.length > 1) {
    return { status: "ambiguous", candidates: unique.map((entry) => entry.candidate) };
  }
  return { status: "resolved", candidates: unique.map((entry) => entry.candidate), lot: unique[0]!.lot };
}

function inWarehouseScope(warehouseId: string, deps: DraftDependencies): boolean {
  return deps.actor.roles.includes("administrator") || deps.actor.unitIds.includes(warehouseId);
}

function resolveWarehouseId(hint: string, override: string | undefined, deps: DraftDependencies): string {
  if (override) {
    if (!inWarehouseScope(override, deps)) throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    return override;
  }
  const available = (deps.warehouses ?? []).filter((warehouse) =>
    UUID_RE.test(warehouse.id) && inWarehouseScope(warehouse.id, deps));
  if (hint) {
    const upper = hint.toLocaleUpperCase("vi");
    const match = available.find((warehouse) => warehouse.id.toLocaleUpperCase("vi") === upper ||
      warehouse.code?.toLocaleUpperCase("vi") === upper ||
      warehouse.name?.toLocaleLowerCase("vi") === hint.toLocaleLowerCase("vi"));
    if (match) return match.id;
    if (UUID_RE.test(hint)) {
      if (!inWarehouseScope(hint, deps)) throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
      return hint;
    }
    return "";
  }
  if (available.length === 1) return available[0]!.id;
  if (deps.actor.unitIds.length === 1) return deps.actor.unitIds[0]!;
  return "";
}

function tracedQuantities(trace: Row): bigint[] {
  const values: string[] = [];
  for (const node of items(trace.nodes)) {
    const source = row(node);
    values.push(text(source.quantity) || text(row(source.summary).quantity));
  }
  for (const edge of items(trace.edges)) values.push(text(row(edge).quantity));
  return values.map(scaled).filter((value): value is bigint => value !== null);
}

function buildWarnings(lot: Row, trace: Row, bundle: ReturnType<typeof buildFactBundle>,
  fields: DraftFields): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  const batchId = text(lot.batchId);
  const quality = text(lot.qualityStatus);
  if (quality && quality !== "available") {
    warnings.push({ code: "quality_not_available",
      message: `Lô có trạng thái chất lượng ${quality}.`, sourceId: batchId });
  }
  if (bundle.verification === "partner_asserted") {
    warnings.push({ code: "origin_partner_asserted",
      message: "Nguồn gốc lô do đối tác khẳng định.", sourceId: batchId });
  }
  const requested = scaled(fields.quantity);
  const current = scaled(bundle.quantity);
  const traced = tracedQuantities(trace);
  const abnormal = requested !== null && (current !== null && requested > current * BigInt(10) ||
    traced.length > 0 && !traced.some((value) => value === requested));
  if (abnormal) {
    warnings.push({ code: "quantity_abnormal",
      message: "Số lượng bất thường so với tồn hoặc số liệu truy vết.", sourceId: batchId });
  }
  if (bundle.gaps.length) {
    warnings.push({ code: "trace_gap", message: "Chuỗi truy vết có khoảng trống.", sourceId: batchId });
  }
  return warnings;
}

function sourceIdsOf(facts: ChatFact[]): string[] {
  return [...new Set(facts.map((fact) => fact.sourceId).filter((id) => UUID_RE.test(id)))];
}

function emptyResponse(hint: string, requestId: string): DraftProposalResponse {
  return { status: "empty", fields: emptyFields(), sources: [], warnings: [],
    proposalId: null, hint, requestId };
}

export async function runDraftProposal(input: unknown, deps: DraftDependencies): Promise<DraftProposalResponse> {
  const parsed = parseProposalInput(input);
  const requestId = requireRequestId(deps.requestId);
  const extraction = extractDraftRequest(parsed.request);
  const hasLot = !!(parsed.batchId || parsed.fields?.batchId || parsed.lotCode ||
    extraction.batchIds.length || extraction.lotCodes.length);
  if (!hasLot) return emptyResponse("LOT_CODE_MISSING", requestId);
  const preferredBatchId = parsed.batchId ?? parsed.fields?.batchId;
  const resolution = await resolveDraftLot({ ...(preferredBatchId ? { batchId: preferredBatchId } : {}),
    ...(parsed.lotCode ? { lotCode: parsed.lotCode } : {}),
    ...(parsed.issuer ? { issuer: parsed.issuer } : {}) }, extraction, deps);
  if (resolution.status === "not_found") return emptyResponse("LOT_NOT_FOUND", requestId);
  if (resolution.status === "ambiguous") {
    return { status: "ambiguous", candidates: resolution.candidates, requestId };
  }
  const lot = resolution.lot!;
  const batchId = text(lot.batchId) || resolution.candidates[0]!.batchId;
  const fields: DraftFields = {
    batchId,
    warehouseId: resolveWarehouseId(extraction.warehouseHint, parsed.fields?.warehouseId, deps),
    quantity: parsed.fields?.quantity ?? extraction.quantity,
    unit: parsed.fields?.unit ?? extraction.unit,
  };
  const ctx = toolContext(deps);
  const stock = row(await deps.runTool("getStock", { batchId }, ctx));
  const trace = row(await deps.runTool("getTrace", { batchId, direction: "backward", depth: 3 }, ctx));
  const bundle = buildFactBundle(lot, stock, trace, (deps.now ?? (() => new Date()))().toISOString());
  const warnings = buildWarnings(lot, trace, bundle, fields);
  const sources = bundle.facts;
  if (!fields.warehouseId || !fields.quantity || !fields.unit) {
    return { status: "incomplete", fields, sources, warnings, requestId };
  }
  const proposalId = draftProposalId(deps.actor.userId, fields, requestId);
  if (deps.auditDraft) {
    await deps.auditDraft.record({ actor: deps.actor, action: "ai.draft.proposed",
      targetType: "ai_draft_proposal", targetId: proposalId, requestId,
      after: { proposalId, warehouseId: fields.warehouseId, batchId: fields.batchId,
        quantity: fields.quantity, unit: fields.unit, sourceIds: sourceIdsOf(sources),
        warnings: warnings.map((warning) => warning.code) } });
  }
  return { status: "proposed", fields, sources, warnings, proposalId, requestId };
}

export async function createReceiptDraftFromProposal(input: unknown,
  deps: DraftDependencies): Promise<DraftCreated> {
  const parsed = parseDraftCreateInput(input);
  const requestId = requireRequestId(deps.requestId);
  if (parsed.proposalId !== draftProposalId(deps.actor.userId, parsed.fields, requestId)) {
    throw new DomainError("AI_DRAFT_PROPOSAL_MISMATCH", 409);
  }
  const result = row(await deps.runTool("createReceiptDraft", {
    ...parsed.fields,
    ...(parsed.note ? { note: parsed.note } : {}),
  }, toolContext(deps, parsed.proposalId)));
  if (result.status !== "draft") throw new DomainError("AI_DRAFT_STATE_INVALID", 503);
  const draftDocumentId = text(result.draftDocumentId);
  if (!UUID_RE.test(draftDocumentId)) throw new DomainError("AI_DRAFT_RESULT_INVALID", 503);
  const sourceIds = [...new Set(items(result.sourceIds)
    .map((id) => text(id)).filter((id) => UUID_RE.test(id)))];
  if (deps.auditDraft) {
    await deps.auditDraft.record({ actor: deps.actor, action: "ai.draft.created",
      targetType: "ai_draft", targetId: draftDocumentId, requestId,
      after: { proposalId: parsed.proposalId, warehouseId: parsed.fields.warehouseId,
        batchId: parsed.fields.batchId, quantity: parsed.fields.quantity, unit: parsed.fields.unit,
        draftDocumentId, sourceIds } });
  }
  return { status: "created", proposalId: parsed.proposalId, draftDocumentId,
    fields: parsed.fields, sourceIds };
}

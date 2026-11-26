// SPDX-License-Identifier: AGPL-3.0-only
import { checkPolicy } from "@/platform/access/policy";
import type { Actor } from "@/platform/identity/actor";
import { DomainError } from "@/platform/kernel/errors";
import type { ToolContext } from "./ports";

type Verification = "local_verified" | "partner_asserted" | "missing";
type FactKind = "quantity" | "unit" | "batchCode" | "issuer" | "eventType" | "gap";
type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TEXT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CODE_RE = /[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+/g;
const ISSUER_RE = /(?:issuer|originIssuerId|nhà phát hành|tổ chức phát hành|from|of|của|từ)\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,79})/gi;
const ISSUER_TOKEN_RE = /nexora-[a-z0-9][a-z0-9._:-]{0,20}/gi;
const INSTRUCTION_PATTERN = "ignore|disregard|override|system|developer|assistant|prompt|instruction|password|secret|token|bearer|api[\\s_-]?key|bỏ qua|quên đi|hãy viết|hãy trả lời|không cần kiểm tra|mật khẩu|khóa bí mật";
const SENSITIVE_PATTERN = "[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}|(?:\\+?\\d[\\s.-]?){10,}|(?:password|secret|token|api[\\s_-]?key)\\s*[:=]";
const UNIT_RE = /(?<!\p{L})(EA|KG|G|L|ML|T|CARTON|BOX|PALLET|HỘP|THÙNG|CÁI|LÍT)(?!\p{L})/gu;

export type ChatFact = {
  kind: FactKind;
  value: string;
  sourceId: string;
  asOf: string;
  verification: Verification;
};

export type AnswerChip = {
  kind: FactKind;
  value: string;
  sourceId: string;
  asOf: string;
  verification: Verification;
};

export type FactBundle = {
  facts: ChatFact[];
  lotCode: string;
  issuer: string;
  productName: string;
  quantity: string;
  unit: string;
  balances: { warehouseId: string; quantity: string }[];
  events: { eventId: string; eventType: string }[];
  verification: Verification;
  gaps: string[];
  asOf: string;
  truncated: { balances: boolean; events: boolean };
  hidden: { balances: number; events: number };
};

export type LotCandidate = {
  batchId: string;
  lotCode: string;
  issuer: string;
  productName: string;
  sourceId: string;
};

export type ChatInput = {
  question: string;
  batchId?: string;
  lotCode?: string;
  issuer?: string;
};

export type ToolRun = (name: string, input: unknown, ctx: ToolContext) => Promise<Row>;

export type GeneratePort = {
  generate(question: string, facts: ChatFact[]): Promise<{ answer: string } | null>;
};

export type AnswerAuditEntry = {
  actor: Actor;
  requestId: string;
  batchId: string;
  quantity: string;
  unit: string;
  sourceIds: string[];
  asOf: string;
  verification: Verification;
  toolCalls: number;
};

export type AnswerAuditPort = { record(entry: AnswerAuditEntry): Promise<void> };

export type ChatDependencies = {
  actor: Actor;
  authorization: string;
  requestId: string;
  runTool: ToolRun;
  generate?: GeneratePort;
  auditAnswer?: AnswerAuditPort;
  allowedIssuers?: readonly string[];
  now?: () => Date;
};

export type ChatResponse =
  | { status: "ambiguous"; candidates: LotCandidate[]; requestId: string }
  | { status: "not_found"; hint: string; requestId: string }
  | {
    status: "answered";
    answer: string;
    connector: string | null;
    facts: ChatFact[];
    sources: AnswerChip[];
    auditRequestId: string;
    aiUnavailable: boolean;
    truncated: FactBundle["truncated"];
    hidden: FactBundle["hidden"];
    toolCalls: number;
    requestId: string;
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

function verification(value: unknown): Verification {
  return value === "partner_asserted" || value === "missing" ? value : "local_verified";
}

export function sanitizePartnerText(value: string, limit = 100): string {
  const clean = text(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
  return clean.split(new RegExp(INSTRUCTION_PATTERN, "i")).join("[redacted]")
    .split(new RegExp(SENSITIVE_PATTERN, "i")).join("[redacted]").slice(0, limit);
}

export function extractLotCodes(question: string): string[] {
  const matches = text(question).match(CODE_RE) ?? [];
  return [...new Set(matches.map((code) => sanitizePartnerText(code, 100)))].filter(Boolean).slice(0, 3);
}

export function extractIssuers(question: string): string[] {
  const source = text(question);
  const explicit = [...source.matchAll(ISSUER_RE)].map((match) => match[1] ?? "");
  const tokens = source.match(ISSUER_TOKEN_RE) ?? [];
  return [...new Set([...explicit, ...tokens].map((issuer) => sanitizePartnerText(issuer, 80)))]
    .filter((issuer) => /^[A-Za-z0-9._:-]+$/.test(issuer)).slice(0, 5);
}

function assertChatInput(input: unknown): ChatInput {
  const body = row(input);
  for (const key of Object.keys(body)) {
    if (!["question", "batchId", "lotCode", "issuer"].includes(key)) {
      throw new DomainError("FIELD_NOT_ALLOWED", 422);
    }
  }
  const question = sanitizePartnerText(text(body.question), 300);
  if (!question || question === "[redacted]") throw new DomainError("QUESTION_INVALID", 422);
  return {
    question,
    ...(typeof body.batchId === "string" ? { batchId: body.batchId } : {}),
    ...(typeof body.lotCode === "string" ? { lotCode: sanitizePartnerText(body.lotCode, 100) } : {}),
    ...(typeof body.issuer === "string" ? { issuer: sanitizePartnerText(body.issuer, 80) } : {}),
  };
}

function candidateFrom(lot: Row): LotCandidate | null {
  const origin = row(lot.originLot);
  const product = row(lot.product);
  const batchId = text(lot.batchId);
  if (!UUID_RE.test(batchId)) return null;
  return {
    batchId,
    lotCode: sanitizePartnerText(text(origin.lotId), 100),
    issuer: sanitizePartnerText(text(origin.issuerInstanceId), 80),
    productName: sanitizePartnerText(text(product.name), 100),
    sourceId: batchId,
  };
}

function visible(candidate: LotCandidate, deps: ChatDependencies): boolean {
  return !deps.allowedIssuers || deps.allowedIssuers.includes(candidate.issuer) ||
    candidate.issuer === deps.actor.organizationId;
}

type Resolution = {
  status: "ambiguous" | "not_found" | "resolved";
  candidates?: LotCandidate[];
  hint?: string;
  lot?: Row;
  toolCalls: number;
};

async function resolveLot(input: ChatInput, deps: ChatDependencies): Promise<Resolution> {
  if (!checkPolicy(deps.actor, "catalog:batch:read").allowed) throw new DomainError("POLICY_DENIED", 403);
  const ctx: ToolContext = { actor: deps.actor, authorization: deps.authorization,
    requestId: deps.requestId, now: deps.now };
  let toolCalls = 0;
  const call = async (name: string, payload: Row): Promise<Row> => {
    toolCalls++;
    return row(await deps.runTool(name, payload, ctx));
  };
  const found: { candidate: LotCandidate; lot: Row }[] = [];
  const batchId = input.batchId ?? text(input.question).match(UUID_TEXT_RE)?.[0] ?? "";
  if (batchId) {
    if (!UUID_RE.test(batchId)) throw new DomainError("BATCH_ID_INVALID", 422);
    const lot = await call("getLot", { batchId });
    const candidate = candidateFrom(lot);
    if (candidate && visible(candidate, deps)) found.push({ candidate, lot });
  } else {
    const codes = input.lotCode ? [input.lotCode] : extractLotCodes(input.question);
    if (!codes.length) throw new DomainError("LOT_CODE_MISSING", 422);
    const issuers = input.issuer ? [input.issuer] : extractIssuers(input.question);
    const pool = issuers.length ? issuers : deps.allowedIssuers ?? [];
    if (!pool.length) throw new DomainError("LOT_ISSUER_MISSING", 422);
    for (const code of codes) {
      for (const issuer of pool) {
        try {
          const lot = await call("getLot", { originIssuerId: issuer, originLotId: code });
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
  if (!unique.length) return { status: "not_found", hint: "/trace", toolCalls };
  if (unique.length > 1) {
    return { status: "ambiguous", candidates: unique.map((entry) => entry.candidate), toolCalls };
  }
  return { status: "resolved", candidates: unique.map((entry) => entry.candidate),
    lot: unique[0]!.lot, toolCalls };
}

export function buildFactBundle(lot: Row, stock: Row, trace: Row, fallbackAsOf: string): FactBundle {
  const origin = row(lot.originLot);
  const product = row(lot.product);
  const lotCode = sanitizePartnerText(text(origin.lotId), 100);
  const issuer = sanitizePartnerText(text(origin.issuerInstanceId), 80);
  const productName = sanitizePartnerText(text(product.name), 100);
  const batchId = text(lot.batchId);
  const quantity = text(stock.visibleTotalQuantity) || "0.000";
  const unit = sanitizePartnerText(text(stock.unit), 20) || "unknown";
  const asOf = text(stock.asOf) || text(trace.asOf) || text(lot.asOf) || fallbackAsOf;
  const balances = items(stock.balances).map((value) => row(value)).map((balance) => ({
    warehouseId: text(balance.warehouseId), quantity: text(balance.quantity),
  })).filter((balance) => UUID_RE.test(balance.warehouseId));
  const events = items(trace.nodes).map((value) => row(value)).map((node) => ({
    eventId: text(node.eventId), eventType: sanitizePartnerText(text(node.eventType), 60),
    verification: verification(node.verificationState),
  }));
  const statuses = [lot.verificationStatus, stock.verificationStatus, trace.verificationStatus].map(verification);
  const verificationValue = statuses.includes("missing") ? "missing"
    : statuses.includes("partner_asserted") || events.some((event) => event.verification === "partner_asserted")
      ? "partner_asserted" : "local_verified";
  const gaps = items(trace.gaps).map((value) => row(value)).map((gap) =>
    sanitizePartnerText(`${text(gap.state)}: ${text(gap.reason)}`, 100));
  const balancesTruncated = stock.truncated === true;
  const eventsTruncated = trace.truncated === true;
  const facts: ChatFact[] = [];
  const push = (kind: FactKind, value: string, sourceId: string, factVerification: Verification) => {
    if (facts.length < 10 && value) facts.push({ kind, value: value.slice(0, 100), sourceId, asOf: asOf.slice(0, 100), verification: factVerification });
  };
  push("batchCode", lotCode, batchId, verificationValue);
  push("issuer", issuer, batchId, verificationValue);
  push("quantity", quantity, batchId, verificationValue);
  push("unit", unit, batchId, verificationValue);
  for (const balance of balances.slice(0, 3)) push("quantity", balance.quantity, balance.warehouseId, verificationValue);
  for (const event of events.slice(0, 3)) push("eventType", event.eventType, event.eventId, event.verification);
  for (const gap of gaps.slice(0, 2)) push("gap", gap, batchId, verificationValue);
  return {
    facts, lotCode, issuer, productName, quantity, unit,
    balances: balances.slice(0, 3), events: events.slice(0, 3).map(({ eventId, eventType }) => ({ eventId, eventType })),
    verification: verificationValue, gaps, asOf,
    truncated: { balances: balancesTruncated, events: eventsTruncated },
    hidden: {
      balances: Math.max(0, balances.length - 3) + (balancesTruncated ? 1 : 0),
      events: Math.max(0, events.length - 3) + (eventsTruncated ? 1 : 0),
    },
  };
}

export function renderAnswer(bundle: FactBundle): string {
  const parts = [`Lô ${bundle.lotCode} (issuer ${bundle.issuer}, sản phẩm ${bundle.productName}).`];
  parts.push(`Tổng tồn hiện tại: ${bundle.quantity} ${bundle.unit}, tính đến ${bundle.asOf}, nguồn ${bundle.facts[0]?.sourceId ?? ""}.`);
  if (bundle.balances.length) {
    parts.push(`Tồn theo kho: ${bundle.balances.map((balance) => `${balance.warehouseId} ${balance.quantity} ${bundle.unit}`).join("; ")}.`);
  }
  if (bundle.events.length) {
    parts.push(`Sự kiện gần nhất: ${bundle.events.map((event) => `${event.eventType} (nguồn ${event.eventId})`).join("; ")}.`);
  }
  if (bundle.gaps.length) parts.push(`Khoảng trống dữ liệu: ${bundle.gaps.join("; ")}.`);
  parts.push(`Trạng thái đối chiếu: ${bundle.verification}.`);
  if (bundle.balances.length > 3 || bundle.truncated.balances) {
    parts.push(`Đang hiển thị 3 kho trong tổng số ${bundle.balances.length + bundle.hidden.balances}${bundle.truncated.balances ? " trở lên" : ""}.`);
  }
  if (bundle.events.length > 3 || bundle.truncated.events) {
    parts.push(`Đang hiển thị 3 sự kiện gần nhất trong tổng số ${bundle.events.length + bundle.hidden.events}${bundle.truncated.events ? " trở lên" : ""}.`);
  }
  return parts.join(" ");
}

export function verifyModelText(value: string, bundle: FactBundle): string | null {
  if (typeof value !== "string") return null;
  const clean = sanitizePartnerText(value, 240);
  if (!clean || clean.includes("[redacted]")) return null;
  const numbers = clean.match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.some((number) => !bundle.facts.some((fact) => fact.value.includes(number)))) return null;
  const ids = clean.match(UUID_TEXT_RE) ?? [];
  if (ids.some((id) => !bundle.facts.some((fact) => fact.sourceId === id))) return null;
  const units = new Set(bundle.facts.filter((fact) => fact.kind === "unit").map((fact) => fact.value.toUpperCase()));
  const mentioned = clean.toUpperCase().match(UNIT_RE) ?? [];
  if (mentioned.some((unit) => !units.has(unit))) return null;
  if (new RegExp(INSTRUCTION_PATTERN, "i").test(clean) || new RegExp(SENSITIVE_PATTERN, "i").test(clean)) return null;
  return clean;
}

export async function runChatLotLookup(input: unknown, deps: ChatDependencies): Promise<ChatResponse> {
  const question = assertChatInput(input);
  const resolution = await resolveLot(question, deps);
  if (resolution.status !== "resolved") {
    return resolution.status === "ambiguous"
      ? { status: "ambiguous", candidates: resolution.candidates ?? [], requestId: deps.requestId }
      : { status: "not_found", hint: resolution.hint ?? "/trace", requestId: deps.requestId };
  }
  const ctx: ToolContext = { actor: deps.actor, authorization: deps.authorization,
    requestId: deps.requestId, now: deps.now };
  const toolCalls = resolution.toolCalls + 2;
  const stock = row(await deps.runTool("getStock", { batchId: resolution.candidates![0]!.batchId }, ctx));
  const trace = row(await deps.runTool("getTrace", { batchId: resolution.candidates![0]!.batchId,
    direction: "backward", depth: 3 }, ctx));
  const bundle = buildFactBundle(resolution.lot ?? {}, stock, trace,
    (deps.now ?? (() => new Date()))().toISOString());
  let connector: string | null = null;
  let aiUnavailable = false;
  if (deps.generate) {
    try {
      const generated = await deps.generate.generate(question.question, bundle.facts);
      connector = generated ? verifyModelText(generated.answer, bundle) : null;
      aiUnavailable = !generated || connector === null && generated.answer.trim().length > 0;
    } catch {
      aiUnavailable = true;
    }
  }
  const answer = connector ? `${renderAnswer(bundle)} ${connector}` : renderAnswer(bundle);
  const sourceIds = [...new Set(bundle.facts.map((fact) => fact.sourceId).filter((id) => UUID_RE.test(id)))];
  if (deps.auditAnswer) {
    await deps.auditAnswer.record({ actor: deps.actor, requestId: deps.requestId,
      batchId: resolution.candidates![0]!.batchId, quantity: bundle.quantity, unit: bundle.unit,
      sourceIds, asOf: bundle.asOf, verification: bundle.verification, toolCalls });
  }
  return { status: "answered", answer, connector, facts: bundle.facts,
    sources: bundle.facts.map((fact) => ({ kind: fact.kind, value: fact.value,
      sourceId: fact.sourceId, asOf: fact.asOf, verification: fact.verification })),
    auditRequestId: deps.requestId, aiUnavailable,
    truncated: bundle.truncated, hidden: bundle.hidden, toolCalls, requestId: deps.requestId };
}

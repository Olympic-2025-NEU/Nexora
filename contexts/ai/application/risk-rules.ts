// SPDX-License-Identifier: AGPL-3.0-only
export const RULESET_VERSION = "risk-v1";

export type RiskVerification = "local_verified" | "partner_asserted" | "missing";

export type RiskFact = {
  kind: string;
  value: string;
  sourceId: string;
  asOf?: string;
  verification?: RiskVerification;
};

export type RiskFactBundle = {
  facts: readonly RiskFact[];
  batchId?: string;
  expiresOn?: string | null;
  qualityStatus?: string | null;
  unit?: string;
  verification?: RiskVerification;
  gaps?: readonly (string | { state: string; reason?: string })[];
};

export type RiskRuleId =
  | "NEAR_EXPIRY"
  | "QUALITY_NOT_AVAILABLE"
  | "DISCREPANCY"
  | "TRACE_GAP_OR_PARTNER";

export type RiskSeverity = "Cần kiểm tra" | "Chú ý";

export type RiskAlert = {
  ruleId: RiskRuleId;
  ruleVersion: string;
  sourceIds: string[];
  asOf: string;
  severity: RiskSeverity;
  explanation: string;
};

export type RiskUnknown = {
  ruleId: RiskRuleId;
  ruleVersion: string;
  sourceIds: string[];
  asOf: string;
  reason: string;
};

export type RiskEvaluation = {
  ruleVersion: string;
  asOf: string;
  alerts: RiskAlert[];
  unknowns: RiskUnknown[];
};

type RiskRule = { ruleId: RiskRuleId; severity: RiskSeverity };

export const RULES: readonly RiskRule[] = [
  { ruleId: "NEAR_EXPIRY", severity: "Chú ý" },
  { ruleId: "QUALITY_NOT_AVAILABLE", severity: "Cần kiểm tra" },
  { ruleId: "DISCREPANCY", severity: "Cần kiểm tra" },
  { ruleId: "TRACE_GAP_OR_PARTNER", severity: "Chú ý" },
];

const DAY_MS = 86_400_000;
const NEAR_EXPIRY_DAYS = 30;

type Outcome =
  | { kind: "alert"; value: RiskAlert }
  | { kind: "unknown"; value: RiskUnknown }
  | null;

function factsOf(bundle: RiskFactBundle, kinds: readonly string[]): RiskFact[] {
  return bundle.facts.filter((fact) => kinds.includes(fact.kind));
}

function sourceIdsOf(facts: readonly RiskFact[], bundle: RiskFactBundle): string[] {
  const ids = facts.map((fact) => fact.sourceId);
  if (bundle.batchId) ids.push(bundle.batchId);
  return [...new Set(ids.filter(Boolean))].sort();
}

function makeAlert(rule: RiskRule, bundle: RiskFactBundle, asOf: string,
  facts: readonly RiskFact[], explanation: string): Outcome {
  return { kind: "alert", value: { ruleId: rule.ruleId, ruleVersion: RULESET_VERSION,
    sourceIds: sourceIdsOf(facts, bundle), asOf, severity: rule.severity,
    explanation: explanation.slice(0, 240) } };
}

function makeUnknown(rule: RiskRule, bundle: RiskFactBundle, asOf: string,
  facts: readonly RiskFact[], reason: string): Outcome {
  return { kind: "unknown", value: { ruleId: rule.ruleId, ruleVersion: RULESET_VERSION,
    sourceIds: sourceIdsOf(facts, bundle), asOf, reason } };
}

function dayIndex(value: string): number | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS;
}

function formatDate(value: string): string {
  const date = new Date(Date.parse(value));
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function nearExpiry(rule: RiskRule, bundle: RiskFactBundle, asOf: string): Outcome {
  const facts = factsOf(bundle, ["expiresOn"]);
  const fact = facts[0];
  const raw = typeof bundle.expiresOn === "string" && bundle.expiresOn ? bundle.expiresOn : fact?.value;
  if (!raw) return makeUnknown(rule, bundle, asOf, facts, "Không có ngày hết hạn trong dữ liệu.");
  const expiryDay = dayIndex(raw);
  const baseDay = dayIndex(asOf);
  if (expiryDay === null || baseDay === null) {
    return makeUnknown(rule, bundle, asOf, facts, "Ngày hết hạn hoặc thời điểm đối chiếu không hợp lệ.");
  }
  if (expiryDay > baseDay + NEAR_EXPIRY_DAYS) return null;
  const days = Math.max(0, expiryDay - baseDay);
  return makeAlert(rule, bundle, asOf, facts,
    `Lô này còn ${days} ngày là hết hạn (hạn: ${formatDate(raw)})`);
}

function qualityNotAvailable(rule: RiskRule, bundle: RiskFactBundle, asOf: string): Outcome {
  const facts = factsOf(bundle, ["qualityStatus"]);
  const fact = facts[0];
  const status = typeof bundle.qualityStatus === "string" && bundle.qualityStatus
    ? bundle.qualityStatus : fact?.value;
  if (!status) return makeUnknown(rule, bundle, asOf, facts, "Không có trạng thái chất lượng trong dữ liệu.");
  if (status === "available") return null;
  return makeAlert(rule, bundle, asOf, facts, `Lô có trạng thái chất lượng ${status.slice(0, 100)}.`);
}

function decimal(value: string): bigint | null {
  const match = value.trim().match(/^(\d{1,15})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  return BigInt(match[1]!) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(3, "0"));
}

function formatQuantity(amount: bigint): string {
  const whole = amount / BigInt(1000);
  const fraction = (amount % BigInt(1000)).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function discrepancy(rule: RiskRule, bundle: RiskFactBundle, asOf: string): Outcome {
  const sent = factsOf(bundle, ["sentQuantity"]);
  const received = factsOf(bundle, ["receivedQuantity", "actualQuantity"]);
  const cannotPair = "Không ghép được cặp số lượng gửi và nhận trong dữ liệu truy vết.";
  if (!sent.length || sent.length !== received.length) {
    return makeUnknown(rule, bundle, asOf, [...sent, ...received], cannotPair);
  }
  for (let index = 0; index < sent.length; index++) {
    const sentFact = sent[index]!;
    const receivedFact = received[index]!;
    const sentQuantity = decimal(sentFact.value);
    const receivedQuantity = decimal(receivedFact.value);
    if (sentQuantity === null || receivedQuantity === null) {
      return makeUnknown(rule, bundle, asOf, [sentFact, receivedFact], cannotPair);
    }
    if (receivedQuantity < sentQuantity) {
      const unit = bundle.unit || factsOf(bundle, ["unit"])[0]?.value || "đơn vị chưa xác định";
      return makeAlert(rule, bundle, asOf, [sentFact, receivedFact],
        `Nhận thực tế ít hơn số đã gửi ${formatQuantity(sentQuantity - receivedQuantity)} ${unit.slice(0, 20)}.`);
    }
  }
  return null;
}

function gapText(bundle: RiskFactBundle, facts: readonly RiskFact[]): string {
  const factValue = facts[0]?.value;
  if (factValue) return factValue.slice(0, 100);
  const gap = bundle.gaps?.[0];
  if (typeof gap === "string") return gap.slice(0, 100);
  if (gap && typeof gap === "object") return `${gap.state}: ${gap.reason ?? "unknown"}`.slice(0, 100);
  return "unknown";
}

function traceGapOrPartner(rule: RiskRule, bundle: RiskFactBundle, asOf: string): Outcome {
  const gaps = factsOf(bundle, ["gap"]);
  const partners = bundle.facts.filter((fact) => fact.verification === "partner_asserted" ||
    fact.kind === "verificationState" && fact.value === "partner_asserted");
  const hasGap = gaps.length > 0 || (bundle.gaps?.length ?? 0) > 0;
  const hasPartner = bundle.verification === "partner_asserted" || partners.length > 0;
  const hasTraceData = bundle.verification !== undefined || bundle.gaps !== undefined ||
    bundle.facts.some((fact) => fact.verification !== undefined ||
      ["gap", "eventType", "verification", "verificationState"].includes(fact.kind));
  if (!hasTraceData) {
    return makeUnknown(rule, bundle, asOf, [], "Không có dữ liệu truy vết trong dữ liệu.");
  }
  if (bundle.verification === "missing") {
    return makeUnknown(rule, bundle, asOf, [], "Dữ liệu đối chiếu truy vết không có sẵn.");
  }
  if (hasGap || hasPartner) {
    const explanation = hasGap ? `Chuỗi truy vết có khoảng trống: ${gapText(bundle, gaps)}.`
      : "Nguồn gốc lô do đối tác khẳng định.";
    return makeAlert(rule, bundle, asOf, [...gaps, ...partners], explanation);
  }
  return null;
}

const EVALUATORS: Record<RiskRuleId, (rule: RiskRule, bundle: RiskFactBundle, asOf: string) => Outcome> = {
  NEAR_EXPIRY: nearExpiry,
  QUALITY_NOT_AVAILABLE: qualityNotAvailable,
  DISCREPANCY: discrepancy,
  TRACE_GAP_OR_PARTNER: traceGapOrPartner,
};

export function evaluateRisk(facts: RiskFactBundle | readonly RiskFact[], asOf: string): RiskEvaluation {
  const bundle: RiskFactBundle = "facts" in facts ? facts : { facts };
  const alerts: RiskAlert[] = [];
  const unknowns: RiskUnknown[] = [];
  for (const rule of RULES) {
    const outcome = EVALUATORS[rule.ruleId](rule, bundle, asOf);
    if (outcome?.kind === "alert") alerts.push(outcome.value);
    if (outcome?.kind === "unknown") unknowns.push(outcome.value);
  }
  return { ruleVersion: RULESET_VERSION, asOf, alerts, unknowns };
}

export type RiskFingerprintInput = Pick<RiskAlert, "ruleId" | "sourceIds" | "ruleVersion">;

export async function alertFingerprint(alert: RiskFingerprintInput): Promise<string> {
  const canonical = [alert.ruleId, [...new Set(alert.sourceIds)].sort().join(","), alert.ruleVersion].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

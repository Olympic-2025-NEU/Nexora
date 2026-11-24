// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";
import envelopeSchema from "./envelope-v1.schema.json";
import transferSchema from "./transfer.schema.json";
import receiptSchema from "./receipt.schema.json";
import impactSchema from "./downstream-impact.schema.json";

export const FEDERATION_MAX_BYTES = 256 * 1024;
export const FEDERATION_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
export const FEDERATION_EVENT_TYPES = ["transfer.announced.v1", "receipt.confirmed.v1",
  "downstream.impact.v1"] as const;
export type FederationEventType = (typeof FEDERATION_EVENT_TYPES)[number];
export type FederationEnvelope = Record<string, unknown> & {
  schemaVersion: "1.0"; messageId: string; eventId: string; eventType: FederationEventType;
  issuerInstanceId: string; recipientInstanceId: string; occurredAt: string; publishedAt: string;
};

export class FederationContractError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(envelopeSchema);
const schemas = new Map<FederationEventType, ReturnType<typeof ajv.compile>>([
  [FEDERATION_EVENT_TYPES[0], ajv.compile(transferSchema)],
  [FEDERATION_EVENT_TYPES[1], ajv.compile(receiptSchema)],
  [FEDERATION_EVENT_TYPES[2], ajv.compile(impactSchema)],
]);

// JSON.parse silently accepts duplicate keys. Reject them before parsing so the
// sender and receiver cannot hash different interpretations of the same bytes.
function rejectDuplicateKeys(raw: string): void {
  const stack: Array<{ object: boolean; expectKey: boolean; keys: Set<string> }> = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index++;
      while (index < raw.length) {
        if (raw[index] === "\\") { index += 2; continue; }
        if (raw[index] === '"') break;
        index++;
      }
      if (index >= raw.length) throw new FederationContractError("INVALID_JSON", 422);
      const frame = stack.at(-1);
      if (frame?.object && frame.expectKey) {
        const key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (frame.keys.has(key)) throw new FederationContractError("DUPLICATE_JSON_KEY", 422);
        frame.keys.add(key);
        frame.expectKey = false;
      }
    } else if (char === "{") stack.push({ object: true, expectKey: true, keys: new Set() });
    else if (char === "[") stack.push({ object: false, expectKey: false, keys: new Set() });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.object) stack[stack.length - 1].expectKey = true;
  }
}

function milli(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}
function sum<T extends object>(rows: T[], key: keyof T): bigint {
  return rows.reduce((total, row) => total + milli(row[key] as string), BigInt(0));
}
function requireBusiness(condition: boolean): void {
  if (!condition) throw new FederationContractError("INVALID_EVENT_PAYLOAD", 422);
}

function checkBusiness(value: FederationEnvelope): void {
  const lots = value.lots as Array<{ quantity: string; unit: string;
    originLot: { issuerInstanceId: string; lotId: string } }>;
  for (const lot of lots) {
    requireBusiness(milli(lot.quantity) > BigInt(0));
    requireBusiness(lot.unit !== "EA" || !lot.quantity.includes("."));
  }
  if (value.eventType === "transfer.announced.v1") {
    requireBusiness(lots.length > 0 && milli(value.sentQuantity as string) === sum(lots, "quantity"));
  } else if (value.eventType === "receipt.confirmed.v1") {
    const lines = value.actualLines as Array<{ sourceLineId: string; sentQuantity: string;
      actualQuantity: string; unit: string }>;
    requireBusiness(new Set(lines.map((line) => line.sourceLineId)).size === lines.length);
    for (const line of lines) {
      requireBusiness(milli(line.actualQuantity) <= milli(line.sentQuantity));
      requireBusiness(line.unit !== "EA" || (!line.actualQuantity.includes(".") &&
        !line.sentQuantity.includes(".")));
    }
    const sent = sum(lines, "sentQuantity");
    const actual = sum(lines, "actualQuantity");
    requireBusiness(milli(value.sentQuantity as string) === sent &&
      milli(value.actualQuantity as string) === actual &&
      milli(value.discrepancyQuantity as string) === sent - actual &&
      sum(lots, "quantity") === actual && (actual > BigInt(0) || lots.length === 0) &&
      (sent === actual || Boolean(value.discrepancyReason)));
  } else {
    const origin = value.originLot as { issuerInstanceId: string; lotId: string };
    requireBusiness(lots.length > 0 && lots.every((lot) =>
      lot.originLot.issuerInstanceId === origin.issuerInstanceId && lot.originLot.lotId === origin.lotId));
  }
}

export function federationHash(value: FederationEnvelope): string {
  const serialized = canonicalize(value);
  if (!serialized) throw new FederationContractError("INVALID_EVENT_PAYLOAD", 422);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export function validateFederationEnvelope(raw: string, context: {
  receiverInstanceId?: string; partnerIssuerInstanceId?: string; now?: Date;
} = {}): { envelope: FederationEnvelope; hash: string; clockSkewWarning: boolean } {
  if (Buffer.byteLength(raw, "utf8") > FEDERATION_MAX_BYTES)
    throw new FederationContractError("PAYLOAD_TOO_LARGE", 413);
  rejectDuplicateKeys(raw);
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new FederationContractError("INVALID_JSON", 422); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FederationContractError("INVALID_EVENT_PAYLOAD", 422);
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== "1.0") throw new FederationContractError("UNSUPPORTED_SCHEMA", 422);
  const validate = schemas.get(candidate.eventType as FederationEventType);
  if (!validate) throw new FederationContractError("UNSUPPORTED_EVENT_TYPE", 422);
  if (!validate(candidate)) throw new FederationContractError("INVALID_EVENT_PAYLOAD", 422);
  const envelope = candidate as FederationEnvelope;
  checkBusiness(envelope);
  if (context.receiverInstanceId !== undefined && envelope.recipientInstanceId !== context.receiverInstanceId)
    throw new FederationContractError("WRONG_RECIPIENT", 403);
  if (context.partnerIssuerInstanceId !== undefined && envelope.issuerInstanceId !== context.partnerIssuerInstanceId)
    throw new FederationContractError("WRONG_ISSUER", 403);
  const now = context.now ?? new Date();
  return { envelope, hash: federationHash(envelope),
    clockSkewWarning: Math.abs(now.getTime() - Date.parse(envelope.publishedAt)) > FEDERATION_CLOCK_TOLERANCE_MS };
}

export function classifyFederationReplay(existing: { issuerInstanceId: string; messageId: string;
  eventId: string; eventType: string; hash: string; ack: unknown } | null,
incoming: { envelope: FederationEnvelope; hash: string }): { kind: "new" | "replay"; ack?: unknown } {
  if (!existing) return { kind: "new" };
  if (existing.issuerInstanceId === incoming.envelope.issuerInstanceId &&
      existing.messageId === incoming.envelope.messageId) {
    if (existing.hash !== incoming.hash) throw new FederationContractError("MESSAGE_ID_REUSED", 409);
    return { kind: "replay", ack: existing.ack };
  }
  if (existing.issuerInstanceId === incoming.envelope.issuerInstanceId &&
      existing.eventId === incoming.envelope.eventId && existing.eventType === incoming.envelope.eventType)
    throw new FederationContractError("EVENT_ID_REUSED", 409);
  return { kind: "new" };
}

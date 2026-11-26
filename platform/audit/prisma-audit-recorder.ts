// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuditEntry, AuditRecorder } from "./audit-recorder";
import { safeErrorCode } from "../observability/diagnostics";

const statuses = new Set([
  "draft", "pending", "pending_approval", "approved", "rejected", "confirmed",
  "cancelled", "active", "disabled", "rotating", "suspended", "clean", "infected", "error",
  "archived", "available", "restricted", "inspect", "stale", "revoked",
]);
const kinds = new Set(["evidence_metadata", "trace_projection", "ot_reading", "archive_manifest"]);
const visibilities = new Set(["private", "partner", "public"]);
const scanStates = new Set(["pending", "clean", "infected", "error"]);
const tools = new Set(["getLot", "getStock", "getTrace", "createReceiptDraft", "createIssueDraft"]);
const verifications = new Set(["local_verified", "partner_asserted", "missing"]);
const changedFields = new Set([
  "status", "version", "role", "visibility", "scanState", "connectionStatus",
  "policyVersion", "scope", "ownerId", "ownerType", "payload", "endpointUrl",
  "warehouseIds",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Copy only fields with bounded values; unknown/nested/PII fields are discarded. */
export function sanitizeAuditSummary(input: unknown): Prisma.InputJsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  const safe: Record<string, Prisma.InputJsonValue> = {};
  if (typeof value.status === "string" && statuses.has(value.status)) safe.status = value.status;
  if (typeof value.lastErrorCode === "string") safe.lastErrorCode = safeErrorCode(value.lastErrorCode) ?? "REDACTED";
  if (typeof value.kind === "string" && kinds.has(value.kind)) safe.kind = value.kind;
  if (typeof value.visibility === "string" && visibilities.has(value.visibility)) safe.visibility = value.visibility;
  if (typeof value.scanState === "string" && scanStates.has(value.scanState)) safe.scanState = value.scanState;
  if (typeof value.tool === "string" && tools.has(value.tool)) safe.tool = value.tool;
  if (Array.isArray(value.sourceIds)) {
    safe.sourceIds = [...new Set(value.sourceIds.filter(
      (id): id is string => typeof id === "string" && UUID_RE.test(id),
    ))].slice(0, 20);
  }
  if (Number.isSafeInteger(value.version) && (value.version as number) > 0) safe.version = value.version as number;
  if (Number.isSafeInteger(value.count) && (value.count as number) >= 0) safe.count = value.count as number;
  if (Number.isSafeInteger(value.warehouseCount) && (value.warehouseCount as number) >= 0) {
    safe.warehouseCount = value.warehouseCount as number;
  }
  if (Array.isArray(value.warehouseIds)) {
    const ids = [...new Set(
      value.warehouseIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)),
    )].slice(0, 50);
    if (ids.length > 0) safe.warehouseIds = ids;
    safe.warehouseCount = ids.length;
  }
  if (typeof value.reason === "string") {
    const reason = value.reason.trim().slice(0, 200);
    if (reason.length > 0 && /^[\p{L}\p{N}\s.,;:_\-/()]+$/u.test(reason)) safe.reason = reason;
  }
  if (typeof value.quantity === "string" && /^\d{1,15}(?:\.\d{1,3})?$/.test(value.quantity)) {
    safe.quantity = value.quantity;
  }
  if (typeof value.unit === "string" && /^[A-Za-z]{1,10}$/.test(value.unit)) safe.unit = value.unit;
  if (typeof value.asOf === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.asOf)) {
    safe.asOf = value.asOf;
  }
  if (typeof value.verification === "string" && verifications.has(value.verification)) {
    safe.verification = value.verification;
  }
  if (typeof value.role === "string" && ["administrator", "staff", "approver", "viewer"].includes(value.role)) {
    safe.role = value.role;
  }
  if (Array.isArray(value.changedFields)) {
    safe.changedFields = [...new Set(value.changedFields.filter(
      (field): field is string => typeof field === "string" && changedFields.has(field),
    ))].slice(0, 20);
  }
  return safe;
}

function bounded(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`Invalid audit ${field}`);
  }
  return value;
}

function requestKey(value: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid audit ${field}`);
  }
  return value;
}

export const prismaAuditRecorder: AuditRecorder<Prisma.TransactionClient> = {
  async record(tx, entry: AuditEntry): Promise<string> {
    const id = randomUUID();
    const actorSub = entry.actor.kind === "user" ? bounded(entry.actor.sub, "actor", 256) : null;
    const clientId = entry.actor.kind === "service" ? bounded(entry.actor.clientId, "client", 256) : null;
    await tx.auditLog.create({ data: {
      id,
      actorSub,
      clientId,
      action: bounded(entry.action, "action", 100),
      targetType: bounded(entry.targetType, "targetType", 80),
      targetId: bounded(entry.targetId, "targetId", 128),
      outcome: entry.outcome ?? "success",
      requestId: requestKey(entry.requestId, "requestId"),
      correlationId: entry.correlationId ? requestKey(entry.correlationId, "correlationId") : null,
      beforeSummary: sanitizeAuditSummary(entry.before),
      afterSummary: sanitizeAuditSummary(entry.after),
    } });
    return id;
  },
};

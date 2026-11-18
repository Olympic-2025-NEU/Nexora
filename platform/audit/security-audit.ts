// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Security audit helper — redacts tokens and PII before logging.
 *
 * Rules:
 * - Bearer tokens, secrets, passwords, keys are NEVER logged.
 * - Sub/email are logged only at audit level (not in access logs).
 * - IP addresses are logged at request level (not user-linkable without context).
 * - Policy denies are always audited with actor role + action (not full identity).
 *
 * Usage:
 *   auditDeny(actor, "trading:goods-issue:create", requestId);
 *   auditAccess(actor, "platform:me:read", "success", requestId);
 */

import type { Actor } from "../identity/actor.js";
import type { PartnerActor } from "../identity/partner-actor.js";

/** Tagged union for audit: Actor gets type="user", PartnerActor already has type="partner". */
type AuditActor = (Actor & { type?: never }) | PartnerActor;

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/** Patterns that must never appear in audit output. */
const SENSITIVE_PATTERNS = [
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*/g, // JWT
  /Bearer\s+[a-zA-Z0-9._-]+/gi,                            // Bearer token
  /"password"\s*:\s*"[^"]*"/gi,                            // JSON password field
  /"secret"\s*:\s*"[^"]*"/gi,                              // JSON secret field
  /"client_secret"\s*:\s*"[^"]*"/gi,                       // OAuth client_secret
];

/**
 * Redact sensitive values from a string before logging.
 * Replaces known token/secret patterns with [REDACTED].
 */
export function redact(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Build a safe actor summary for audit logs.
 * Never includes the full sub UUID in high-frequency access logs;
 * uses a truncated form for correlation only.
 */
export function actorSummary(actor: AuditActor): Record<string, unknown> {
  if ("clientId" in actor && actor.type === "partner") {
    const p = actor as PartnerActor;
    return {
      type: "partner",
      partnerCode: p.partnerCode,
      clientId: p.clientId.slice(0, 12) + "…",
    };
  }
  const u = actor as Actor;
  return {
    type: "user",
    // Truncated sub for log correlation — not for identity display.
    subPrefix: u.userId.slice(0, 8) + "…",
    roles: u.roles,
    organizationId: u.organizationId,
  };
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export interface AuditEvent {
  timestamp: string;
  requestId: string | null;
  action: string;
  outcome: "success" | "deny" | "failure";
  actor: Record<string, unknown>;
  detail?: string;
}

/**
 * Log a policy deny event.
 * Always logged (even if deny is expected) for security visibility.
 */
export function auditDeny(
  actor: AuditActor,
  action: string,
  requestId: string | null,
  detail?: string,
): void {
  const event: AuditEvent = {
    timestamp: new Date().toISOString(),
    requestId,
    action,
    outcome: "deny",
    actor: actorSummary(actor),
    detail: detail ? redact(detail) : undefined,
  };
  // Use structured JSON output — never use string interpolation that could leak tokens.
  console.warn(JSON.stringify({ service: "nexora-security-audit", ...event }));
}

/**
 * Log a successful access event.
 */
export function auditAccess(
  actor: AuditActor,
  action: string,
  outcome: "success" | "failure",
  requestId: string | null,
): void {
  const event: AuditEvent = {
    timestamp: new Date().toISOString(),
    requestId,
    action,
    outcome,
    actor: actorSummary(actor),
  };
  console.info(JSON.stringify({ service: "nexora-security-audit", ...event }));
}

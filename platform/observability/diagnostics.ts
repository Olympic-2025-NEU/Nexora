// SPDX-License-Identifier: AGPL-3.0-only
const errorCodes = new Set([
  "OFFLINE", "UNKNOWN_DESTINATION", "LEASE_EXPIRED", "DELIVERY_FAILED", "INVALID_EVENT_PAYLOAD",
  "UNSUPPORTED_EVENT_VERSION", "NON_RETRYABLE", "FLOWABLE_UNAVAILABLE",
]);
const haltReasons = new Set([
  "DUPLICATE_PROCESS", "BINDING_MISMATCH", "PROCESS_VANISHED", "EXTERNAL_COMPLETION",
  "HISTORY_WITHOUT_DECISION", "DECISION_CONFLICT", "INVALID_START_VARIABLES", "ENGINE_REJECTED_START",
]);

export function safeErrorCode(value: string | null): string | null {
  return value === null ? null : errorCodes.has(value) ? value : "REDACTED";
}

export function safeHaltReason(value: string | null): string {
  return value !== null && haltReasons.has(value) ? value : "REDACTED";
}

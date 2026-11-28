// SPDX-License-Identifier: AGPL-3.0-only
/** Trusted identity from the verified user or service context, never request JSON. */
export type AuditIdentity =
  | { kind: "user"; sub: string }
  | { kind: "service"; clientId: string };

export type AuditEntry = {
  actor: AuditIdentity;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  outcome?: "success" | "deny" | "failure";
  correlationId?: string;
  before?: unknown;
  after?: unknown;
};

/** The caller supplies the same transaction context as the aggregate write. */
export type AuditRecorder<Context = unknown> = {
  record(context: Context, entry: AuditEntry): Promise<string>;
};

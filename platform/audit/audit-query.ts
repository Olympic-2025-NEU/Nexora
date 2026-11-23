// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "../identity/actor";
import { requirePolicy } from "../access/policy";

export type AuditFilters = {
  limit: number;
  cursor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  outcome?: "success" | "deny" | "failure";
  from?: Date;
  to?: Date;
};

export type AuditListItem = {
  id: string;
  createdAt: string;
  actorSub?: string;
  clientId?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  requestId: string;
  correlationId?: string;
};

export type AuditPage = { data: AuditListItem[]; page: { limit: number; nextCursor?: string } };
export type AuditQueryRepository = { list(filters: AuditFilters): Promise<AuditPage> };

export class AuditQueryError extends Error {
  readonly code = "INVALID_AUDIT_QUERY";
  constructor() {
    super("Invalid audit query parameter");
    this.name = "AuditQueryError";
  }
}

const allowed = new Set(["cursor", "limit", "action", "targetType", "targetId", "requestId", "outcome", "from", "to"]);

function bounded(value: string | null, max: number): string | undefined {
  if (value === null) return undefined;
  if (value.length < 1 || value.length > max || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new AuditQueryError();
  return value;
}

function date(value: string | null): Date | undefined {
  if (value === null) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new AuditQueryError();
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDay.getUTCFullYear() !== Number(year) ||
      calendarDay.getUTCMonth() + 1 !== Number(month) ||
      calendarDay.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) {
    throw new AuditQueryError();
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new AuditQueryError();
  return result;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new AuditQueryError();
  }
  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^[1-9][0-9]{0,2}$/.test(rawLimit)) throw new AuditQueryError();
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (limit > 100) throw new AuditQueryError();
  const outcome = params.get("outcome");
  if (outcome !== null && !["success", "deny", "failure"].includes(outcome)) throw new AuditQueryError();
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    throw new AuditQueryError();
  }
  const from = date(params.get("from"));
  const to = date(params.get("to"));
  if (from && to && from > to) throw new AuditQueryError();
  return {
    limit,
    cursor: cursor ?? undefined,
    action: bounded(params.get("action"), 100),
    targetType: bounded(params.get("targetType"), 80),
    targetId: bounded(params.get("targetId"), 128),
    requestId: bounded(params.get("requestId"), 128),
    outcome: outcome as AuditFilters["outcome"] ?? undefined,
    from,
    to,
  };
}

export function listAuditForAdministrator(
  actor: Actor,
  params: URLSearchParams,
  repository: AuditQueryRepository,
): Promise<AuditPage> {
  requirePolicy(actor, "platform:audit:read");
  return repository.list(parseAuditFilters(params));
}

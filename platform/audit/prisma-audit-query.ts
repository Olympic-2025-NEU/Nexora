// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditFilters, AuditQueryRepository } from "./audit-query";
import { AuditQueryError } from "./audit-query";

type Cursor = { id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const auditSelect = {
  id: true, createdAt: true, actorSub: true, clientId: true, action: true,
  targetType: true, targetId: true, outcome: true, requestId: true, correlationId: true,
} satisfies Prisma.AuditLogSelect;

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed || !uuid.test(parsed.id)) throw new Error();
    return parsed;
  } catch {
    throw new AuditQueryError();
  }
}

function encodeCursor(row: Cursor): string {
  return Buffer.from(JSON.stringify(row)).toString("base64url");
}

export function prismaAuditQueryRepository(db: PrismaClient): AuditQueryRepository {
  return {
    async list(filters: AuditFilters) {
      const where: Prisma.AuditLogWhereInput = {
        ...(filters.action && { action: filters.action }),
        ...(filters.targetType && { targetType: filters.targetType }),
        ...(filters.targetId && { targetId: filters.targetId }),
        ...(filters.requestId && { requestId: filters.requestId }),
        ...(filters.outcome && { outcome: filters.outcome }),
        ...((filters.from || filters.to) && { createdAt: { gte: filters.from, lte: filters.to } }),
      };
      const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
      const rows = await db.auditLog.findMany({
        where, select: auditSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: filters.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      });
      const pageRows = rows.slice(0, filters.limit);
      const last = pageRows.at(-1);
      return {
        data: pageRows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          ...(row.actorSub ? { actorSub: row.actorSub } : {}),
          ...(row.clientId ? { clientId: row.clientId } : {}),
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          outcome: row.outcome,
          requestId: row.requestId,
          ...(row.correlationId ? { correlationId: row.correlationId } : {}),
        })),
        page: {
          limit: filters.limit,
          ...(rows.length > filters.limit && last ? {
            nextCursor: encodeCursor({ id: last.id }),
          } : {}),
        },
      };
    },
  };
}

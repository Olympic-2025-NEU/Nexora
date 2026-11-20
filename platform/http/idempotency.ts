// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";
import { DomainError } from "../kernel/errors";
import { IdempotencyClaimLostError, type IdempotencyPort, type IdempotencyScope, type LookupOutcome } from "./command-ports";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Pass the exact parsed command body to CommandOptions.payload; never hash caller-supplied digests. */
export function hashPayload(payload: unknown): string {
  const serialized = canonicalize(payload);
  if (serialized === undefined) throw new DomainError("IDEMPOTENCY_PAYLOAD_INVALID", 400);
  return createHash("sha256").update(serialized).digest("hex");
}

export function validateIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new DomainError("IDEMPOTENCY_KEY_INVALID", 400);
}

export function createPrismaIdempotency(client: PrismaClient): IdempotencyPort {
  const where = (scope: IdempotencyScope) => ({
    actorOrClient_method_routeKey_idempotencyKey: {
      actorOrClient: scope.actorOrClient, method: scope.method, routeKey: scope.routeKey,
      idempotencyKey: scope.key,
    },
  });
  return {
    async lookup(scope): Promise<LookupOutcome> {
      const record = await client.idempotencyRecord.findUnique({ where: where(scope) });
      if (!record || record.expiresAt < new Date()) return { kind: "fresh" };
      if (record.payloadSha256 !== scope.payloadSha256) throw new DomainError("IDEMPOTENCY_CONFLICT", 409);
      if (record.state === "completed") return { kind: "replay", result: record.responseBody };
      return { kind: "fresh" };
    },
    async claim(tx, scope) {
      const now = new Date();
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + RETENTION_MS);
      const inserted = await tx.idempotencyRecord.createMany({
        data: [{
          id, actorOrClient: scope.actorOrClient, method: scope.method, routeKey: scope.routeKey,
          idempotencyKey: scope.key, payloadSha256: scope.payloadSha256, state: "processing", expiresAt,
        }],
        skipDuplicates: true,
      });
      if (inserted.count === 1) return { recordId: id };
      const old = await tx.idempotencyRecord.findUnique({ where: where(scope) });
      if (old?.state === "completed" && old.expiresAt < now) {
        const updated = await tx.idempotencyRecord.updateMany({
          where: { id: old.id, state: "completed", expiresAt: { lt: now } },
          data: {
            createdAt: now, expiresAt, payloadSha256: scope.payloadSha256, state: "processing",
            responseBody: Prisma.DbNull, responseStatus: null, resourceId: null,
          },
        });
        if (updated.count === 1) return { recordId: old.id };
      }
      throw new IdempotencyClaimLostError("Idempotency claim held by another transaction");
    },
    async complete(tx, recordId, result) {
      const serialized = canonicalize(result);
      if (serialized === undefined) throw new DomainError("IDEMPOTENCY_RESULT_INVALID", 400);
      const body = JSON.parse(serialized) as Prisma.InputJsonValue | null;
      const resourceId = result && typeof result === "object" && "id" in result &&
        typeof result.id === "string" && UUID.test(result.id) ? result.id : null;
      const updated = await tx.idempotencyRecord.updateMany({
        where: { id: recordId, state: "processing" },
        data: { state: "completed", responseBody: body === null ? Prisma.JsonNull : body, resourceId },
      });
      if (updated.count !== 1) throw new Error("Idempotency claim missing during completion");
    },
    async purgeExpired(now = new Date()) {
      const removed = await client.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: now }, state: { not: "processing" } },
      });
      return removed.count;
    },
  };
}

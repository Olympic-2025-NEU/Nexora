// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import { resolveUserActor } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import {
  decodeIdCursor,
  encodeCursor,
  fail,
  isUuid,
  mapRouteError,
  ok,
  parsePage,
  projectBatch,
} from "@/contexts/catalog/application/http";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import { listOtReadingsForBatch } from "@/contexts/traceability/application/ot-ingest";
import { PrismaClient } from "@prisma/client";

function corePrisma(): PrismaClient {
  const url = process.env.CORE_DATABASE_URL;
  if (!url) return getPrismaClient();
  return new PrismaClient({ datasources: { db: { url } } });
}

export async function lotHistoryRoute(request: NextRequest, batchId: string): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  let core: PrismaClient | undefined;
  try {
    if (!isUuid(batchId)) throw new DomainError("BATCH_ID_INVALID", 422);
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "trace:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    for (const key of params.keys()) {
      if (!["cursor", "limit"].includes(key) || params.getAll(key).length !== 1) {
        throw new DomainError("HISTORY_QUERY_INVALID", 422);
      }
    }
    const { limit, cursor } = parsePage(params);
    const batch = await createCatalogRepos(getPrismaClient()).findBatchById(batchId);
    if (!batch) throw new DomainError("BATCH_NOT_FOUND", 404);

    const db = getPrismaClient();
    core = corePrisma();
    const [rows, otReadings] = await Promise.all([
      db.traceEvent.findMany({
        where: { batchId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: decodeIdCursor(cursor) }, skip: 1 } : {}),
        select: {
          id: true,
          eventType: true,
          issuerInstanceId: true,
          occurredAt: true,
          documentId: true,
          verificationState: true,
        },
      }),
      listOtReadingsForBatch(core, batchId),
    ]);
    const page = rows.slice(0, limit);
    const next = rows.length > limit ? encodeCursor(page[page.length - 1]!.id) : undefined;
    const payload = {
      lot: projectBatch(batch),
      events: page.map((event) => ({
        eventId: event.id,
        type: event.eventType,
        issuer: event.issuerInstanceId,
        occurredAt: event.occurredAt.toISOString(),
        ...(event.documentId ? { sourceDocumentId: event.documentId } : {}),
        verificationState: event.verificationState,
        gap: event.verificationState !== "local_verified",
      })),
      otReadings: otReadings.slice(0, 50),
      ...(next ? { nextCursor: next } : {}),
    };
    const response = ok(payload, requestId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return mapRouteError(error, requestId);
  } finally {
    if (core && core !== getPrismaClient()) await core.$disconnect().catch(() => undefined);
  }
}

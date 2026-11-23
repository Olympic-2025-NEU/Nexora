// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { checkPolicy } from "@/platform/access/policy";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  decodeIdCursor,
  encodeCursor,
  fail,
  isDateOnly,
  isUuid,
  mapRouteError,
  ok,
  okList,
  parsePage,
  projectBatch,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import type { QualityStatus } from "@/contexts/catalog/domain/types";
import { catalogAuditRecorder, catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

const QUALITY_STATUSES = new Set<string>(["available", "restricted", "inspect"]);

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:batch:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    const { limit, cursor } = parsePage(params);
    const productId = params.get("productId");
    if (productId !== null && !isUuid(productId)) throw new DomainError("PRODUCT_ID_INVALID", 422);
    const productVariantId = params.get("productVariantId");
    if (productVariantId !== null && !isUuid(productVariantId)) {
      throw new DomainError("VARIANT_ID_INVALID", 422);
    }
    const status = params.get("status");
    if (status !== null && !QUALITY_STATUSES.has(status)) {
      throw new DomainError("INVALID_STATUS", 422);
    }
    const expiresBefore = params.get("expiresBefore");
    if (expiresBefore !== null && !isDateOnly(expiresBefore)) {
      throw new DomainError("DATE_INVALID", 422);
    }
    const issuer = params.get("issuer");

    const page = await catalogRepos().listBatches({
      ...(productId ? { productId } : {}),
      ...(productVariantId ? { productVariantId } : {}),
      ...(issuer ? { issuer } : {}),
      ...(status ? { status: status as QualityStatus } : {}),
      ...(expiresBefore ? { expiresBefore } : {}),
      ...(cursor ? { cursorId: decodeIdCursor(cursor) } : {}),
      limit,
    });
    return okList(
      page.items.map(projectBatch),
      {
        limit,
        nextCursor: page.nextCursorId ? encodeCursor(page.nextCursorId) : null,
      },
      requestId,
    );
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    // issuer / sourcePartnerId / quality are server-assigned; user JSON cannot supply them.
    const body = assertBody(await readJson(request), [
      "productVariantId",
      "productId",
      "localCode",
      "manufacturedOn",
      "expiresOn",
    ]);
    const productVariantId =
      typeof body.productVariantId === "string" ? body.productVariantId : null;
    if (!productVariantId || !isUuid(productVariantId)) {
      throw new DomainError("VARIANT_ID_INVALID", 422);
    }
    const localCode = requireText(body.localCode, "LOCAL_CODE_INVALID", 80);
    if (body.manufacturedOn !== undefined && !isDateOnly(body.manufacturedOn)) {
      throw new DomainError("DATE_INVALID", 422);
    }
    if (body.expiresOn !== undefined && !isDateOnly(body.expiresOn)) {
      throw new DomainError("DATE_INVALID", 422);
    }
    const manufacturedOn = (body.manufacturedOn as string | undefined) ?? null;
    const expiresOn = (body.expiresOn as string | undefined) ?? null;
    if (manufacturedOn && expiresOn && manufacturedOn > expiresOn) {
      throw new DomainError("BATCH_DATES_INVALID", 422);
    }
    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:batch:create",
        method: "POST",
        routeKey: "batches",
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const instanceId = process.env.INSTANCE_ID?.trim();
          if (!instanceId) throw new DomainError("INSTANCE_ID_NOT_CONFIGURED", 500);
          const sub = ctx.actor.userId;
          const repos = createCatalogRepos(ctx.tx);
          const variant = await repos.findVariantById(productVariantId);
          if (!variant || variant.deletedAt || !variant.isActive) {
            throw new DomainError("VARIANT_NOT_FOUND", 404);
          }
          const product = await repos.findProductById(variant.productId);
          if (!product || !product.isActive || product.deletedAt) {
            throw new DomainError("PRODUCT_ARCHIVED", 409);
          }
          const batchId = randomUUID();
          let created;
          try {
            created = await repos.createBatch({
              id: batchId,
              productVariantId,
              localCode,
              originIssuerInstanceId: instanceId,
              originLotId: batchId,
              manufacturedOn,
              expiresOn,
              createdBySub: sub,
            });
          } catch (err) {
            if (
              typeof err === "object" &&
              err !== null &&
              "code" in err &&
              (err as { code: string }).code === "P2002"
            ) {
              throw new DomainError("BATCH_LOCAL_CODE_CONFLICT", 409);
            }
            throw err;
          }
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: "batch.create",
            targetType: "batch",
            targetId: created.id,
            requestId: ctx.requestId,
            after: { status: created.qualityStatus, version: created.version },
          });
          return created;
        },
      },
    );
    return ok(projectBatch(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

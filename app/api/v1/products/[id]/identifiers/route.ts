// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  isUuid,
  mapRouteError,
  ok,
  projectIdentifier,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { assertValidEan13 } from "@/contexts/catalog/domain/ean13";
import type { IdentifierKind } from "@/contexts/catalog/domain/types";
import { catalogAuditRecorder } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Params): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("PRODUCT_NOT_FOUND", 404);
    const body = assertBody(await readJson(request), ["kind", "value", "isPrimary"]);
    if (body.kind !== "ean13" && body.kind !== "internal_barcode") {
      throw new DomainError("IDENTIFIER_KIND_INVALID", 422);
    }
    const kind: IdentifierKind = body.kind;
    const value = requireText(body.value, "IDENTIFIER_VALUE_INVALID", 128);
    if (kind === "ean13") assertValidEan13(value);
    if (body.isPrimary !== undefined && typeof body.isPrimary !== "boolean") {
      throw new DomainError("IS_PRIMARY_INVALID", 422);
    }
    const isPrimary = body.isPrimary === true;

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:manage",
        method: "POST",
        routeKey: `products/${id}/identifiers`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const sub = ctx.actor.userId;
          const repos = createCatalogRepos(ctx.tx);
          const product = await repos.findProductById(id);
          if (!product) throw new DomainError("PRODUCT_NOT_FOUND", 404);
          if (product.status !== "active") throw new DomainError("PRODUCT_ARCHIVED", 409);
          let created;
          try {
            created = await repos.createIdentifier({
              id: randomUUID(),
              productId: id,
              kind,
              value,
              isPrimary,
            });
          } catch (err) {
            if (err instanceof Error && /Unique constraint/i.test(err.message)) {
              throw new DomainError("IDENTIFIER_CONFLICT", 409);
            }
            throw err;
          }
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub },
            action: "product.identifier.create",
            targetType: "product",
            targetId: id,
            requestId: ctx.requestId,
            after: { status: product.status, version: product.version },
          });
          return created;
        },
      },
    );
    return ok(projectIdentifier(data), requestId, 201);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

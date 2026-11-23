// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { runCommand } from "@/platform/http/pipeline";
import { DomainError } from "@/platform/kernel/errors";
import { createCatalogRepos } from "@/contexts/catalog/infrastructure/prisma-repos";
import {
  assertBody,
  isUuid,
  mapRouteError,
  ok,
  parseIfMatchVersion,
  projectVariant,
  readJson,
} from "@/contexts/catalog/application/http";
import { catalogAuditRecorder } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new DomainError("VARIANT_ID_INVALID", 422);
    const body = assertBody(await readJson(request), [
      "sku",
      "barcode",
      "isPrimary",
      "isActive",
      "version",
    ]);
    const version = parseIfMatchVersion(request.headers.get("if-match"), body.version);
    if (version === null) throw new DomainError("VERSION_REQUIRED", 428);

    const data = await runCommand(
      { requestId },
      {
        authenticate: () => resolveUserActor(request),
        resolveTenant: async (actor) => {
          if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          return actor.organizationId;
        },
        action: "catalog:product:manage",
        method: "PATCH",
        routeKey: `variants/${id}`,
        payload: body,
        async domain(ctx) {
          if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
          const repos = createCatalogRepos(ctx.tx);
          const updated = await repos.updateVariant(id, version, {
            ...(body.sku !== undefined
              ? { sku: typeof body.sku === "string" ? body.sku : null }
              : {}),
            ...(body.barcode !== undefined
              ? { barcode: typeof body.barcode === "string" ? body.barcode : null }
              : {}),
            ...(typeof body.isPrimary === "boolean" ? { isPrimary: body.isPrimary } : {}),
            ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
          });
          if (!updated) throw new DomainError("VARIANT_VERSION_CONFLICT", 409);
          await catalogAuditRecorder().record(ctx.tx, {
            actor: { kind: "user", sub: ctx.actor.userId },
            action: "variant.update",
            targetType: "product_variant",
            targetId: id,
            requestId: ctx.requestId,
            after: { sku: updated.sku, barcode: updated.barcode, version: updated.version },
          });
          return updated;
        },
      },
    );
    return ok(projectVariant(data), requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

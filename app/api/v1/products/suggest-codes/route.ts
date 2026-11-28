// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import {
  assertBody,
  fail,
  isUuid,
  mapRouteError,
  ok,
  readJson,
  requireText,
} from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

/**
 * POST /api/v1/products/suggest-codes
 * Body: { name, excludeVariantId?, reservedCodes? }
 * Returns next suggested SKU/barcode (same algorithm for both).
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "catalog:product:create");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const body = assertBody(await readJson(request), [
      "name",
      "excludeVariantId",
      "reservedCodes",
    ]);
    const name = requireText(body.name, "PRODUCT_NAME_INVALID", 200);

    let excludeVariantId: string | null = null;
    if (body.excludeVariantId !== undefined && body.excludeVariantId !== null) {
      if (!isUuid(body.excludeVariantId)) {
        throw new DomainError("VARIANT_ID_INVALID", 422);
      }
      excludeVariantId = body.excludeVariantId;
    }

    const reservedCodes: string[] = [];
    if (body.reservedCodes !== undefined) {
      if (!Array.isArray(body.reservedCodes)) {
        throw new DomainError("RESERVED_CODES_INVALID", 422);
      }
      for (const item of body.reservedCodes) {
        if (typeof item !== "string") {
          throw new DomainError("RESERVED_CODES_INVALID", 422);
        }
        const trimmed = item.trim();
        if (trimmed) reservedCodes.push(trimmed);
      }
    }

    const result = await catalogRepos().suggestVariantCode({
      name,
      excludeVariantId,
      reservedCodes,
    });
    return ok({ code: result.code }, requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import { projectBalance } from "@/contexts/inventory/application/http";
import {
  decodeCursor,
  encodeCursor,
  fail,
  isUuid,
  mapRouteError,
  okList,
  parsePage,
} from "@/contexts/catalog/application/http";
import { inventoryRepos, warehouseScope } from "@/composition/inventory";
import { resolveUserActor } from "@/composition/system";

function optionalUuid(value: string | null, code: string): string | undefined {
  if (value === null || value === "") return undefined;
  if (!isUuid(value)) throw new DomainError(code, 422);
  return value;
}

/** Cursor wraps the last composite key `warehouseId:batchId`. */
function decodeBalanceCursor(cursor: string | null) {
  if (!cursor) return undefined;
  const [warehouseId, batchId, extra] = decodeCursor(cursor).split(":");
  if (extra !== undefined || !isUuid(warehouseId) || !isUuid(batchId)) {
    throw new DomainError("CURSOR_INVALID", 422);
  }
  return { warehouseId, batchId };
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "inventory:stock:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    const { limit, cursor } = parsePage(params);
    const warehouseId = optionalUuid(params.get("warehouseId"), "WAREHOUSE_ID_INVALID");
    const productId = optionalUuid(params.get("productId"), "PRODUCT_ID_INVALID");
    const batchId = optionalUuid(params.get("batchId"), "BATCH_ID_INVALID");
    const cursorKey = decodeBalanceCursor(cursor);
    const scopeIds = warehouseScope(actor);

    const page = await inventoryRepos().listBalances({
      ...(warehouseId ? { warehouseId } : {}),
      ...(productId ? { productId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(scopeIds ? { scopeIds } : {}),
      ...(cursorKey ? { cursor: cursorKey } : {}),
      limit,
    });
    return okList(
      page.items.map(projectBalance),
      {
        limit,
        nextCursor: page.next ? encodeCursor(`${page.next.warehouseId}:${page.next.batchId}`) : null,
      },
      requestId,
    );
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

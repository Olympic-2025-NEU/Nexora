// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import { projectMovement } from "@/contexts/inventory/application/http";
import {
  decodeIdCursor,
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

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const actor = await resolveUserActor(request);
    const { allowed } = checkPolicy(actor, "inventory:stock:read");
    if (!allowed) return fail("POLICY_DENIED", 403, requestId);

    const params = request.nextUrl.searchParams;
    const { limit, cursor } = parsePage(params);
    const warehouseId = optionalUuid(params.get("warehouseId"), "WAREHOUSE_ID_INVALID");
    const batchId = optionalUuid(params.get("batchId"), "BATCH_ID_INVALID");
    const scopeIds = warehouseScope(actor);

    const page = await inventoryRepos().listMovements({
      ...(warehouseId ? { warehouseId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(scopeIds ? { scopeIds } : {}),
      ...(cursor ? { cursorId: decodeIdCursor(cursor) } : {}),
      limit,
    });
    return okList(
      page.items.map(projectMovement),
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

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import { isUuid, mapRouteError, ok, projectVariantUom } from "@/contexts/catalog/application/http";
import { catalogRepos } from "@/composition/catalog";
import { resolveUserActor } from "@/composition/system";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DomainError("VARIANT_ID_INVALID", 422);
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "catalog:uom:read").allowed) throw new DomainError("POLICY_DENIED", 403);
    const repos = catalogRepos();
    if (!await repos.findVariantById(id)) throw new DomainError("VARIANT_NOT_FOUND", 404);
    return ok((await repos.listVariantUoms(id)).map(projectVariantUom), requestId);
  } catch (err) { return mapRouteError(err, requestId); }
}

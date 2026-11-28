// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPolicy } from "@/platform/access/policy";
import { DomainError } from "@/platform/kernel/errors";
import { mapRouteError } from "@/contexts/catalog/application/http";
import { createInboundService } from "@/contexts/trading/application/inbound";
import { resolveUserActor } from "@/composition/system";
import { tradingPorts } from "@/composition/trading";
import { getPrismaClient } from "@/platform/persistence/prisma";

function localIssuerInstanceId() {
  return (
    process.env.NEXORA_ISSUER_INSTANCE_ID?.trim() ||
    (process.env.INSTANCE_ID?.trim() ? `nexora-${process.env.INSTANCE_ID.trim()}` : "") ||
    "nexora-a"
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const actor = await resolveUserActor(request);
    if (!checkPolicy(actor, "trading:inbound:read").allowed) {
      throw new DomainError("POLICY_DENIED", 403);
    }
    const sourceKindRaw = request.nextUrl.searchParams.get("sourceKind");
    const sourceKind =
      sourceKindRaw === "local" || sourceKindRaw === "nexora" ? sourceKindRaw : undefined;
    if (sourceKindRaw && !sourceKind) throw new DomainError("SOURCE_KIND_INVALID", 422);
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const service = createInboundService(tradingPorts, localIssuerInstanceId());
    const page = await service.list(
      { tx: getPrismaClient(), actor, requestId, emit: () => {} },
      { sourceKind, status, q },
    );
    return NextResponse.json({ data: page.items, requestId });
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

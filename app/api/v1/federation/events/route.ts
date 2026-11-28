// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBearerToken, TokenError } from "@/platform/identity/token";
import { resolvePartnerActor, PartnerActorError } from "@/platform/identity/partner-actor";
import { partnerConnectionRepository } from "@/composition/system";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { auditDeny } from "@/platform/audit/security-audit";
import { FederationContractError, FEDERATION_MAX_BYTES } from "@/contracts/events/federation";
import { receiveFederationEvent } from "@/contexts/federation/application/receive-event";
import { MappingError } from "@/contexts/federation/application/identity-mapping";

async function boundedBody(request: NextRequest): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > FEDERATION_MAX_BYTES) throw new FederationContractError("PAYLOAD_TOO_LARGE", 413);
  if (!request.body) throw new FederationContractError("INVALID_JSON", 422);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEDERATION_MAX_BYTES) throw new FederationContractError("PAYLOAD_TOO_LARGE", 413);
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof TypeError) throw new FederationContractError("INVALID_JSON", 422);
    throw error;
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");
  let actor;
  try {
    const claims = await verifyBearerToken(request.headers.get("authorization"), {
      jwksUri: process.env.OIDC_JWKS_URL ?? process.env.OIDC_JWKS_URI ?? "",
      issuer: process.env.OIDC_ISSUER_URL ?? "", audience: process.env.OIDC_AUDIENCE ?? "",
    });
    actor = await resolvePartnerActor(claims, partnerConnectionRepository());
  } catch (error) {
    if (error instanceof TokenError) return NextResponse.json({ error: error.code,
      retryable: false }, { status: error.httpStatus });
    if (error instanceof PartnerActorError) return NextResponse.json({ error: error.code,
      retryable: false }, { status: error.httpStatus });
    return NextResponse.json({ error: "AUTH_UNAVAILABLE", retryable: true }, { status: 503 });
  }
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      throw new FederationContractError("UNSUPPORTED_MEDIA_TYPE", 415);
    const raw = await boundedBody(request);
    const ack = await receiveFederationEvent(getPrismaClient(), raw, actor,
      process.env.NEXORA_ISSUER_INSTANCE_ID ?? "");
    return NextResponse.json(ack, { status: 202 });
  } catch (error) {
    if (error instanceof FederationContractError || error instanceof MappingError) {
      auditDeny(actor, "federation.event.receive", requestId, error.code);
      return NextResponse.json({ error: error.code, retryable: false }, { status: error.status });
    }
    console.error(JSON.stringify({ service: "federation-inbound", error: "INBOX_UNAVAILABLE" }));
    return NextResponse.json({ error: "INBOX_UNAVAILABLE", retryable: true }, { status: 503 });
  }
}

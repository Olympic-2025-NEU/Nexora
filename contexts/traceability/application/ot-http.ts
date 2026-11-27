// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveUserActor } from "@/composition/system";
import { requirePolicy } from "@/platform/access/policy";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { mapRouteError } from "@/contexts/catalog/application/http";
import { ingestOtReading, loadDeviceRegistry, OtIngestError, type OtIngestInput } from "./ot-ingest";

const MAX_BODY_BYTES = 4096;
const FIELDS = new Set(["deviceId", "readingId", "batchId", "value", "observedAt"]);

export async function readInput(request: NextRequest): Promise<OtIngestInput> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new OtIngestError("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new OtIngestError("OT_PAYLOAD_TOO_LARGE", 413);
  if (!request.body) throw new OtIngestError("OT_JSON_INVALID", 400);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new OtIngestError("OT_PAYLOAD_TOO_LARGE", 413);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OtIngestError("OT_JSON_INVALID", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OtIngestError("OT_JSON_INVALID", 400);
  }
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some((key) => !FIELDS.has(key)) ||
    [...FIELDS].some((key) => typeof value[key] !== "string")) {
    throw new OtIngestError("OT_JSON_INVALID", 400);
  }
  return value as OtIngestInput;
}

export async function otReadingRoute(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  let core: PrismaClient | undefined;
  try {
    const actor = await resolveUserActor(request);
    requirePolicy(actor, "ops:ot:ingest");
    const input = await readInput(request);
    const coreUrl = process.env.CORE_DATABASE_URL;
    const instanceId = process.env.NEXORA_ISSUER_INSTANCE_ID;
    if (!coreUrl || !instanceId) throw new OtIngestError("OT_STORAGE_UNAVAILABLE", 503);
    core = new PrismaClient({ datasources: { db: { url: coreUrl } } });
    const result = await ingestOtReading(getPrismaClient(), core, loadDeviceRegistry(), input, instanceId);
    return NextResponse.json({ data: result, requestId }, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OtIngestError) {
      return NextResponse.json({ error: error.code, retryable: error.httpStatus === 503, requestId },
        { status: error.httpStatus });
    }
    return mapRouteError(error, requestId);
  } finally {
    await core?.$disconnect().catch(() => undefined);
  }
}

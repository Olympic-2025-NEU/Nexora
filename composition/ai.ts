// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "./system";
import { createToolExecutor } from "@/contexts/ai/application/execute-tool";
import { createBusinessApi } from "@/contexts/ai/infrastructure/business-api";
import { toolAudit } from "@/contexts/ai/infrastructure/tool-audit";

/** Internal orchestration entry point for P10-T03/T04. No public tool route. */
export async function executeAiTool(request: NextRequest, name: string, input: unknown,
  idempotencyKey?: string) {
  const actor = await resolveUserActor(request);
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : crypto.randomUUID();
  return createToolExecutor(createBusinessApi(), toolAudit)(name, input, {
    actor, authorization: request.headers.get("authorization") ?? "", requestId, idempotencyKey,
  });
}

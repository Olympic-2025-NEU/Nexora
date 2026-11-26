// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "./system";
import { createToolExecutor } from "@/contexts/ai/application/execute-tool";
import { runChatLotLookup, type AnswerAuditPort } from "@/contexts/ai/application/chat-lot-lookup";
import { createBusinessApi } from "@/contexts/ai/infrastructure/business-api";
import { createAiGenerateClient } from "@/contexts/ai/infrastructure/ai-generate-client";
import { toolAudit } from "@/contexts/ai/infrastructure/tool-audit";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";

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

const answerAudit: AnswerAuditPort = {
  async record(entry) {
    await getPrismaClient().$transaction((tx) => prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: entry.actor.userId },
      action: "ai.chat.answer",
      targetType: "ai_chat_answer",
      targetId: entry.batchId,
      requestId: entry.requestId,
      after: {
        quantity: entry.quantity,
        unit: entry.unit,
        sourceIds: entry.sourceIds,
        asOf: entry.asOf,
        verification: entry.verification,
        count: entry.toolCalls,
      },
    }));
  },
};

export async function answerChatQuestion(request: NextRequest, input: unknown) {
  const actor = await resolveUserActor(request);
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : crypto.randomUUID();
  return runChatLotLookup(input, {
    actor,
    authorization: request.headers.get("authorization") ?? "",
    requestId,
    runTool: createToolExecutor(createBusinessApi(), toolAudit),
    generate: createAiGenerateClient(),
    auditAnswer: answerAudit,
  });
}

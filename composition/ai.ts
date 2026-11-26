// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { resolveUserActor } from "./system";
import { createToolExecutor } from "@/contexts/ai/application/execute-tool";
import { runChatLotLookup, type AnswerAuditPort } from "@/contexts/ai/application/chat-lot-lookup";
import {
  createReceiptDraftFromProposal,
  parseDraftCreateInput,
  runDraftProposal,
  type DraftAuditPort,
  type DraftWarehouse,
} from "@/contexts/ai/application/draft-receipt";
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

const draftAudit: DraftAuditPort = {
  async record(entry) {
    await getPrismaClient().$transaction((tx) => prismaAuditRecorder.record(tx, {
      actor: { kind: "user", sub: entry.actor.userId },
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      requestId: entry.requestId,
      after: entry.after,
    }));
  },
};

async function draftDependencies(request: NextRequest) {
  const actor = await resolveUserActor(request);
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : crypto.randomUUID();
  const warehouses: DraftWarehouse[] = await getPrismaClient().warehouse.findMany({
    where: actor.roles.includes("administrator") ? undefined : { id: { in: [...actor.unitIds] } },
    select: { id: true, code: true, name: true },
  });
  return {
    actor,
    authorization: request.headers.get("authorization") ?? "",
    requestId,
    runTool: createToolExecutor(createBusinessApi(), toolAudit),
    warehouses,
    auditDraft: draftAudit,
  };
}

export async function proposeAiDraft(request: NextRequest, input: unknown) {
  return runDraftProposal(input, await draftDependencies(request));
}

export async function createAiDraft(request: NextRequest, input: unknown) {
  const deps = await draftDependencies(request);
  const created = await createReceiptDraftFromProposal(parseDraftCreateInput(input), deps);
  return { ...created, requestId: deps.requestId };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { RULES, type RiskRuleId } from "@/contexts/ai/application/risk-rules";
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

export type RiskFeedbackInput = {
  alertFingerprint: string;
  ruleId: RiskRuleId;
  ruleVersion: string;
  verdict: "correct" | "incorrect";
};

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const RULE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/;

export function parseRiskFeedbackInput(input: unknown): RiskFeedbackInput {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const rawFingerprint = body.alertFingerprint;
  const alertFingerprint = typeof rawFingerprint === "string" ? rawFingerprint.toLowerCase() : "";
  const rawRuleId = body.ruleId;
  const ruleId = typeof rawRuleId === "string" &&
    RULES.some((rule) => rule.ruleId === rawRuleId) ? rawRuleId as RiskRuleId : null;
  const rawVersion = body.ruleVersion;
  const ruleVersion = typeof rawVersion === "string" ? rawVersion : "";
  const verdict = body.verdict;
  if (!FINGERPRINT_RE.test(alertFingerprint) || !ruleId || !RULE_VERSION_RE.test(ruleVersion) ||
      (verdict !== "correct" && verdict !== "incorrect")) {
    throw new DomainError("AI_RISK_FEEDBACK_INVALID", 422);
  }
  return { alertFingerprint, ruleId, ruleVersion, verdict };
}

export async function submitRiskFeedback(request: NextRequest, input: unknown) {
  const actor = await resolveUserActor(request);
  const feedback = parseRiskFeedbackInput(input);
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedId)
    ? suppliedId : crypto.randomUUID();
  const entry = { ...feedback, actorId: actor.userId };
  await getPrismaClient().$transaction((tx) => prismaAuditRecorder.record(tx, {
    actor: { kind: "user", sub: actor.userId },
    action: "ai.risk.feedback",
    targetType: "ai_risk_alert",
    targetId: feedback.alertFingerprint,
    requestId,
    after: entry,
  }));
  return { ...entry, requestId };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "@/platform/identity/actor";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { prismaAuditRecorder } from "@/platform/audit/prisma-audit-recorder";
import type { ToolAuditPort } from "../application/ports";
import type { ToolName } from "../application/tool-registry";

const DRAFTS = new Set<ToolName>(["createReceiptDraft", "createIssueDraft"]);

/** Durable per-actor reservation. Advisory lock closes the concurrent quota race. */
export const toolAudit: ToolAuditPort = {
  async reserve(actor: Actor, tool: ToolName, requestId: string): Promise<boolean> {
    const db = getPrismaClient();
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'nexora-ai:' + actor.userId}, 0))::text`;
      const since = new Date(Date.now() - 60_000);
      const total = await tx.auditLog.count({ where: {
        actorSub: actor.userId, action: "ai.tool.reserve", createdAt: { gte: since },
      } });
      const drafts = DRAFTS.has(tool) ? await tx.auditLog.count({ where: {
        actorSub: actor.userId, action: "ai.tool.reserve", createdAt: { gte: since },
        targetId: { in: [...DRAFTS] },
      } }) : 0;
      if (total >= 30 || drafts >= 5) {
        await prismaAuditRecorder.record(tx, {
          actor: { kind: "user", sub: actor.userId }, action: `ai.tool.${tool}`,
          targetType: "ai_tool", targetId: tool, requestId, outcome: "deny",
          after: { tool },
        });
        return false;
      }
      await prismaAuditRecorder.record(tx, {
        actor: { kind: "user", sub: actor.userId }, action: "ai.tool.reserve",
        targetType: "ai_tool_quota", targetId: tool, requestId, after: { tool },
      });
      return true;
    });
  },

  async complete(actor: Actor, tool: ToolName, requestId: string,
    outcome: "success" | "deny" | "failure", sourceIds: string[] = []): Promise<void> {
    await getPrismaClient().$transaction(async (tx) => {
      await prismaAuditRecorder.record(tx, {
        actor: { kind: "user", sub: actor.userId }, action: `ai.tool.${tool}`,
        targetType: "ai_tool", targetId: tool, requestId, outcome,
        after: { tool, sourceIds },
      });
    });
  },
};

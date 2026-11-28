// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createOutboxDispatcher } from "../platform/outbox/dispatcher";
import { buildHandlerMap } from "../composition/event-handlers";
import { membershipActorResolver, applyApprovalResult } from "../composition/workflow";
import { EVENT_DESTINATIONS, WORKFLOW_EVENT_TYPES } from "../contracts/events/registry";
import { FlowableClient } from "../platform/workflow/flowable-client";
import { createFlowableStarter } from "../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../platform/workflow/flowable-decider";
import { createReconciler } from "../platform/workflow/reconciler";
import { scanStuckWork } from "../platform/observability/alerts";
import { traceConsumers, traceLag } from "./trace-projector";
import { createFederationOutboundHandler } from "./federation-outbound";

export function main(client: PrismaClient, core: PrismaClient, issuerInstanceId: string) {
  const engine = FlowableClient.fromEnv();
  const reconciler = createReconciler(client, engine, applyApprovalResult);
  const handlers = buildHandlerMap({ traceability: traceConsumers(client, core, issuerInstanceId),
    workflow: new Map([
      [WORKFLOW_EVENT_TYPES.requested, createFlowableStarter(client, engine)],
      [WORKFLOW_EVENT_TYPES.decisionRequested, createFlowableDecider(client, engine, membershipActorResolver(client))],
    ]) });
  handlers.set(EVENT_DESTINATIONS.federation, createFederationOutboundHandler(client, issuerInstanceId));
  const dispatcher = createOutboxDispatcher({ client, workerId: `worker-${randomUUID()}`,
    handlers });
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try { await dispatcher.tick(); }
    catch { console.error(JSON.stringify({ service: "outbox-dispatcher", outcome: "tick_failed" })); }
    if (!stopped) setTimeout(poll, 1_000);
  };
  void poll();
  const interval = setInterval(() => { if (!stopped) void reconciler.tick(); }, 5_000);
  const scan = () => { if (!stopped) void scanStuckWork(client).catch(() => {
    console.error(JSON.stringify({ event: "ops.scan.failed", service: "outbox-dispatcher" }));
  });
    if (!stopped) void traceLag(client).then((lag) => {
      if (lag.seconds > 300) console.error(JSON.stringify({ event: "trace.projector.lag",
        service: "outbox-dispatcher", pending: lag.pending, seconds: lag.seconds }));
    }).catch(() => console.error(JSON.stringify({ event: "trace.projector.lag_probe_failed" })));
  };
  scan();
  const alertInterval = setInterval(scan, 60_000);
  const pruneEvidence = () => { if (!stopped) void client.traceEvidenceAccess.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60_000) } },
  }).catch(() => console.error(JSON.stringify({ event: "trace.evidence_access.prune_failed",
    service: "outbox-dispatcher" }))); };
  const pruneInterval = setInterval(pruneEvidence, 10 * 60_000);
  return { dispatcher, stop: () => { stopped = true; clearInterval(interval);
    clearInterval(alertInterval); clearInterval(pruneInterval); } };
}

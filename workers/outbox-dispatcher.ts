// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createOutboxDispatcher } from "../platform/outbox/dispatcher";
import { buildHandlerMap } from "../composition/event-handlers";
import { membershipActorResolver } from "../composition/workflow";
import { WORKFLOW_EVENT_TYPES } from "../contracts/events/registry";
import { FlowableClient } from "../platform/workflow/flowable-client";
import { createFlowableStarter } from "../platform/workflow/flowable-starter";
import { createFlowableDecider } from "../platform/workflow/flowable-decider";
import { createReconciler } from "../platform/workflow/reconciler";
import { scanStuckWork } from "../platform/observability/alerts";

export function main(client: PrismaClient) {
  const engine = FlowableClient.fromEnv();
  const reconciler = createReconciler(client, engine);
  const dispatcher = createOutboxDispatcher({ client, workerId: `worker-${randomUUID()}`,
    handlers: buildHandlerMap({ workflow: new Map([
      [WORKFLOW_EVENT_TYPES.requested, createFlowableStarter(client, engine)],
      [WORKFLOW_EVENT_TYPES.decisionRequested, createFlowableDecider(client, engine, membershipActorResolver(client))],
    ]) }) });
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
  }); };
  scan();
  const alertInterval = setInterval(scan, 60_000);
  return { dispatcher, stop: () => { stopped = true; clearInterval(interval); clearInterval(alertInterval); } };
}

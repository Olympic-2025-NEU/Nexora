// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { createOutboxDispatcher } from "../platform/outbox/dispatcher";

export function main(client: PrismaClient) {
  const dispatcher = createOutboxDispatcher({ client, workerId: `worker-${process.pid}`,
    handlers: new Map() });
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try { await dispatcher.tick(); }
    catch { console.error(JSON.stringify({ service: "outbox-dispatcher", outcome: "tick_failed" })); }
    if (!stopped) setTimeout(poll, 1_000);
  };
  void poll();
  return { dispatcher, stop: () => { stopped = true; } };
}

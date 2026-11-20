// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from "@prisma/client";
import { createOutboxDispatcher } from "../../platform/outbox/dispatcher";

const client = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
const mode = process.argv[2];
const dispatcher = createOutboxDispatcher({ client, workerId: `child-${process.pid}`, leaseMs: 1_000,
  handlers: new Map([["local", async (message) => {
    if (mode === "before") process.send?.({ stage: "before", id: message.id });
    else process.send?.({ stage: "received", id: message.id });
    await new Promise<void>((resolve) => process.once("message", () => resolve()));
  }]]) });

async function poll() {
  try { await dispatcher.tick(); }
  catch (error) { process.send?.({ stage: "error", error: String(error) }); }
  setTimeout(poll, 20);
}
void poll();

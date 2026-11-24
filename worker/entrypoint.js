// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";
import { connect } from "node:net";
import { PrismaClient } from "@prisma/client";
import { validateConfig } from "../deploy/config.mjs";
import { requestId, response, log, timed } from "../deploy/health.mjs";
import { main as startOutbox } from "./dist/workers/outbox-dispatcher.js";
import { createPrismaIdempotency } from "./dist/platform/http/idempotency.js";
import { traceLag } from "./dist/workers/trace-projector.js";
import { resolvePendingDependencies } from "./dist/contexts/federation/application/identity-mapping.js";

validateConfig(process.env, "worker");
const prisma = new PrismaClient();
const core = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
const { dispatcher } = startOutbox(prisma, core, process.env.NEXORA_ISSUER_INSTANCE_ID);
const idempotency = createPrismaIdempotency(prisma);
async function purgeIdempotency() {
  try {
    const deleted = await idempotency.purgeExpired();
    console.log(JSON.stringify({ service: "worker", outcome: "idempotency_purge", deleted }));
  } catch {
    console.error(JSON.stringify({ service: "worker", outcome: "idempotency_purge_failed" }));
  }
}
setInterval(() => { void purgeIdempotency(); }, 60 * 60 * 1_000);
async function reconcileFederation() {
  try {
    const resolved = await resolvePendingDependencies(prisma);
    if (resolved) console.log(JSON.stringify({ service: "worker", outcome: "federation_resolved", resolved }));
  } catch {
    console.error(JSON.stringify({ service: "worker", outcome: "federation_resolver_failed" }));
  }
}
setInterval(() => { void reconcileFederation(); }, 60_000);
void reconcileFederation();
function redisPing() {
  return timed(new Promise((resolve, reject) => {
    const url = new URL(process.env.REDIS_URL);
    const socket = connect(Number(url.port || 6379), url.hostname);
    socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
    socket.once("data", (data) => { socket.destroy(); if (data.toString().startsWith("+PONG")) resolve(); else reject(Error("redis")); });
    socket.once("error", reject);
    socket.once("close", () => reject(Error("redis")));
  }));
}
async function ready(id) {
  try {
    const auth = Buffer.from(`${process.env.FLOWABLE_ADMIN_USER}:${process.env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64");
    await Promise.all([
      timed(prisma.$queryRaw`SELECT 1`), timed(core.$queryRaw`SELECT 1`), redisPing(),
      fetch(`${process.env.FLOWABLE_BASE_URL.replace(/\/$/, "")}/service/management/engine`, {
        headers: { authorization: `Basic ${auth}`, "x-request-id": id }, signal: AbortSignal.timeout(2000),
      }).then((result) => { if (!result.ok) throw Error("workflow"); }),
    ]);
    return true;
  } catch { return false; }
}

http.createServer(async (req, res) => {
  const id = requestId(req.headers["x-request-id"]);
  if (req.url === "/health/live") return response(res, "worker", id, true);
  if (req.url === "/health/ready") {
    const up = await ready(id);
    return response(res, "worker", id, up, up ? undefined : "dependency_unavailable");
  }
  if (req.url === "/metrics") {
    const up = await ready(id);
    log("worker", id, "metrics", up ? "up" : "down");
    let stats, lag;
    try { [stats, lag] = await Promise.all([dispatcher.stats(), traceLag(prisma)]); }
    catch { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store", "x-request-id": id });
    res.end(`# TYPE service_up gauge\nservice_up{service="worker"} ${Number(up)}\n# TYPE worker_queue_depth gauge\nworker_queue_depth ${stats.pending + stats.retryDue + stats.leased}\n# TYPE worker_outbox_dead_letter gauge\nworker_outbox_dead_letter ${stats.deadLetter}\n# TYPE trace_projection_pending gauge\ntrace_projection_pending ${lag.pending}\n# TYPE trace_projection_lag_seconds gauge\ntrace_projection_lag_seconds ${lag.seconds}\n`);
    return;
  }
  res.writeHead(404); res.end();
}).listen(8081, "0.0.0.0", () => log("worker", randomId(), "heartbeat", "listening"));
function randomId() { return requestId(); }
setInterval(() => log("worker", randomId(), "heartbeat", "up"), 30_000);

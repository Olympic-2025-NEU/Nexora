// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";
import { connect } from "node:net";
import { PrismaClient } from "@prisma/client";
import { validateConfig } from "../deploy/config.mjs";
import { requestId, response, log, timed } from "../deploy/health.mjs";

validateConfig(process.env, "worker");
const prisma = new PrismaClient();
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
      timed(prisma.$queryRaw`SELECT 1`), redisPing(),
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
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store", "x-request-id": id });
    // Queue has no dispatcher until P04. NaN means depth unavailable, not empty.
    res.end(`# TYPE service_up gauge\nservice_up{service="worker"} ${Number(up)}\n# TYPE worker_queue_depth gauge\nworker_queue_depth NaN\n`);
    return;
  }
  res.writeHead(404); res.end();
}).listen(8081, "0.0.0.0", () => log("worker", randomId(), "heartbeat", "listening"));
function randomId() { return requestId(); }
setInterval(() => log("worker", randomId(), "heartbeat", "up"), 30_000);

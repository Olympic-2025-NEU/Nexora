// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { validateConfig } from "./config.mjs";
import { requestId, response, timed, bucketProbe, log } from "./health.mjs";
import { createAuthenticator } from "./auth.mjs";
import { createFileService } from "./files/upload-service.mjs";
import { createS3FileStore } from "./files/s3-store.mjs";
import { handleFileRequest } from "./files/http.mjs";
import { createClamAvScanner } from "./files/clamav.mjs";

validateConfig(process.env, "core-data");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.CORE_DATABASE_URL } } });
const store = createS3FileStore(process.env);
const scanner = createClamAvScanner();
const fileHandler = { authenticate: createAuthenticator(prisma, process.env),
  files: createFileService(prisma, store) };
async function ready() {
  try {
    await Promise.all([timed(prisma.$queryRaw`SELECT 1`), bucketProbe(process.env), timed(scanner.version())]);
    return true;
  } catch { return false; }
}
const server = http.createServer(async (req, res) => {
  const id = requestId(req.headers["x-request-id"]);
  if (req.url === "/health/live" || req.url === "/api/v1/health/live") return response(res, "core-data", id, true);
  if (req.url === "/health/ready" || req.url === "/api/v1/health/ready") {
    const up = await ready();
    return response(res, "core-data", id, up, up ? undefined : "dependency_unavailable");
  }
  if (req.url === "/metrics") {
    const up = await ready();
    log("core-data", id, "metrics", up ? "up" : "down");
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store", "x-request-id": id });
    res.end(`# TYPE service_up gauge\nservice_up{service="core-data"} ${Number(up)}\n`);
    return;
  }
  if (await handleFileRequest(req, res, fileHandler)) return;
  res.writeHead(404, { "content-type": "application/json", "x-request-id": id });
  res.end(JSON.stringify({ error: "not_found", requestId: id }));
});
server.listen(Number(process.env.PORT || 8080), "0.0.0.0");

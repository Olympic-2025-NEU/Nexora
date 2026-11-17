// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";

const port = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health/live" || req.url === "/health/ready") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "core-data", stub: true }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", note: "P03 product API not implemented" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ service: "core-data", status: "listening", port }));
});

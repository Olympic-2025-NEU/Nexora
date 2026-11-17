// SPDX-License-Identifier: AGPL-3.0-only
import http from "node:http";

const port = Number(process.env.PORT || 3001);
http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("dx-lab stub — P11\n");
  })
  .listen(port, "0.0.0.0");

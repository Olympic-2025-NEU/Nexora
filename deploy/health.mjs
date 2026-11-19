// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID, createHmac, createHash } from "node:crypto";

export const requestId = (value) => /^[a-zA-Z0-9_-]{1,64}$/.test(value || "") ? value : randomUUID();
export const log = (service, id, event, status) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service, requestId: id, event, status }));
export const response = (res, service, id, ready, reason) => {
  log(service, id, "health", ready ? "up" : "down");
  res.writeHead(ready ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": id });
  res.end(JSON.stringify({ status: ready ? "up" : "down", ...(reason ? { reason } : {}), requestId: id }));
};
export async function timed(promise, ms = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("timeout")), ms); })]);
  } finally { clearTimeout(timer); }
}

// Signed S3 HEAD confirms bucket access, not merely an open TCP port.
export async function bucketProbe(env) {
  const url = new URL(`${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET_PRIVATE}`);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const region = env.S3_REGION || "us-east-1";
  const hash = createHash("sha256").update("").digest("hex");
  const scope = `${day}/${region}/s3/aws4_request`;
  const canonical = `HEAD\n${url.pathname}\n\nhost:${url.host}\nx-amz-content-sha256:${hash}\nx-amz-date:${date}\n\nhost;x-amz-content-sha256;x-amz-date\n${hash}`;
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${env.S3_SECRET_KEY}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const result = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000), headers: {
    "x-amz-date": date, "x-amz-content-sha256": hash,
    authorization: `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  } });
  if (!result.ok) throw Error("storage");
}

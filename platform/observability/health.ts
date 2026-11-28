// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { getAppCommit, getAppVersion } from "../version";

export function requestId(header: string | null) {
  return header && /^[a-zA-Z0-9_-]{1,64}$/.test(header) ? header : randomUUID();
}

export function log(service: string, requestId: string, event: string, status: string) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service, requestId, event, status }));
}

export function healthResponse(request: Request, service: string, ready: boolean, reason?: string) {
  const id = requestId(request.headers.get("x-request-id"));
  const status = ready ? "up" : "down";
  log(service, id, "health", status);
  const commit = getAppCommit();
  return Response.json(
    {
      status,
      service,
      version: getAppVersion(),
      ...(commit ? { commit } : {}),
      ...(reason ? { reason } : {}),
      requestId: id,
    },
    {
      status: ready ? 200 : 503,
      headers: { "x-request-id": id, "cache-control": "no-store" },
    },
  );
}

export async function timed<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

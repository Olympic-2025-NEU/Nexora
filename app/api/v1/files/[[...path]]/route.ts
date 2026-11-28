// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Host-side Next BFF for Core Data files.
 *
 * Production traffic hits APISIX `/api/v1/files*` → core-data. Local `npm run
 * dev` serves the ERP on :3000, so browser FormData POSTs would otherwise be
 * treated as Next Server Actions (409). This catch-all proxies to the gateway
 * over Node http/https (Next's patched fetch can reject loopback upstreams).
 */
import type { NextRequest } from "next/server";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const FORWARD_REQ = new Set([
  "authorization",
  "content-type",
  "idempotency-key",
  "if-match",
  "if-none-match",
  "accept",
  "x-request-id",
  "x-correlation-id",
]);

const FORWARD_RES = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "x-request-id",
  "cache-control",
  "etag",
  "last-modified",
]);

function gatewayBase(): string {
  const raw =
    process.env.NEXORA_GATEWAY_URL?.trim() ||
    process.env.FILES_UPSTREAM_BASE?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    "http://127.0.0.1:19080";
  return raw.replace(/\/$/, "");
}

function upstreamUrl(request: NextRequest, path: string[] | undefined): URL {
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join("/")}` : "";
  const url = new URL(`${gatewayBase()}/api/v1/files${suffix}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url;
}

function pickRequestHeaders(
  request: NextRequest,
  method: string,
  bodyLength: number,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {
    accept: request.headers.get("accept") ?? "application/json, */*",
  };
  if (method !== "GET" && method !== "HEAD") {
    headers["content-length"] = bodyLength;
  }
  for (const name of FORWARD_REQ) {
    if (name === "accept") continue;
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function proxyHttp(
  target: URL,
  method: string,
  headers: http.OutgoingHttpHeaders,
  body: Buffer,
): Promise<{ status: number; statusText: string; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 502,
            statusText: res.statusMessage ?? "",
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("FILES_UPSTREAM_TIMEOUT"));
    });
    req.on("error", reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}

function toResponse(upstream: {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (!value) continue;
    if (!FORWARD_RES.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(new Uint8Array(upstream.body), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxy(
  request: NextRequest,
  path: string[] | undefined,
): Promise<Response> {
  const target = upstreamUrl(request, path);
  const method = request.method.toUpperCase();
  const rawBody =
    method === "GET" || method === "HEAD"
      ? Buffer.alloc(0)
      : Buffer.from(await request.arrayBuffer());

  try {
    const upstream = await proxyHttp(
      target,
      method,
      pickRequestHeaders(request, method, rawBody.length),
      rawBody,
    );
    return toResponse(upstream);
  } catch (err) {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const message = err instanceof Error ? err.message : "upstream unreachable";
    console.warn(
      JSON.stringify({
        service: "erp",
        route: "/api/v1/files",
        code: "FILES_UPSTREAM_UNAVAILABLE",
        requestId,
        message,
        target: target.origin,
      }),
    );
    return Response.json(
      {
        code: "FILES_UPSTREAM_UNAVAILABLE",
        message: "File service unavailable",
        requestId,
      },
      { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function HEAD(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PUT(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

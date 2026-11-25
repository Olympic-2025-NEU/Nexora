// SPDX-License-Identifier: AGPL-3.0-only
import type { BusinessApiPort } from "../application/ports";

export class BusinessApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

/** Fixed loopback target. Neither prompt nor tool input can supply a URL or host. */
export function createBusinessApi(fetcher: typeof fetch = fetch): BusinessApiPort {
  const port = process.env.PORT ?? "3000";
  if (!/^[0-9]{1,5}$/.test(port) || +port < 1 || +port > 65535) {
    throw new Error("Invalid ERP port");
  }
  const origin = `http://127.0.0.1:${port}`;

  async function call(method: "GET" | "POST", path: string, authorization: string,
    requestId: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    if (!path.startsWith("/api/v1/") || path.includes("..") || path.includes("//")) {
      throw new BusinessApiError(400, "AI_TOOL_ROUTE_INVALID");
    }
    let response: Response;
    try {
      response = await fetcher(origin + path, {
        method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
        headers: {
          authorization,
          "x-request-id": requestId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new BusinessApiError(503, "AI_BUSINESS_API_UNAVAILABLE");
    }
    if (!response.ok) {
      const status = [401, 403, 404, 409, 422, 429].includes(response.status) ? response.status : 503;
      throw new BusinessApiError(status, status === 403 ? "POLICY_DENIED" : "AI_BUSINESS_API_REJECTED");
    }
    try {
      const decoded: unknown = await response.json();
      if (!decoded || typeof decoded !== "object" || !("data" in decoded)) throw new Error("shape");
      return decoded;
    } catch {
      throw new BusinessApiError(503, "AI_BUSINESS_API_INVALID_RESPONSE");
    }
  }

  return {
    get: (path, authorization, requestId) => call("GET", path, authorization, requestId),
    post: (path, body, authorization, requestId, key) =>
      call("POST", path, authorization, requestId, body, key),
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { proposeAiDraft } from "@/composition/ai";
import { mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const result = await proposeAiDraft(request, await readJson(request));
    return ok(result, requestId ?? result.requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

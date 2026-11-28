// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { createAiDraft } from "@/composition/ai";
import { mapRouteError, ok, readJson } from "@/contexts/catalog/application/http";
import { parseDraftCreateInput } from "@/contexts/ai/application/draft-receipt";

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  try {
    const result = await createAiDraft(request, parseDraftCreateInput(await readJson(request)));
    return ok(result, requestId ?? result.requestId);
  } catch (err) {
    return mapRouteError(err, requestId);
  }
}

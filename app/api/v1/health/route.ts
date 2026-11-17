// SPDX-License-Identifier: AGPL-3.0-only
import { modules } from "@/platform/modules";

export function GET() {
  return Response.json({
    status: "ok",
    platform: modules.platform,
    contexts: modules.contexts,
  });
}

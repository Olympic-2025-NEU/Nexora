// SPDX-License-Identifier: AGPL-3.0-only
import { authConfig } from "../../../lib/auth/config";

export function GET() {
  try {
    authConfig();
    return Response.json({ status: "ok", service: "dx-lab" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ status: "degraded", service: "dx-lab" }, { status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

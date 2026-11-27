// SPDX-License-Identifier: AGPL-3.0-only
export function GET() {
  return Response.json({ status: "ok", service: "dx-lab" }, {
    headers: { "Cache-Control": "no-store" },
  });
}

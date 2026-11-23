// SPDX-License-Identifier: AGPL-3.0-only
// Compatibility stub — Next.js .next/types/validator.ts references this module.
// Live/ready sub-routes handle actual health checks.
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok" });
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { handleAuditGet } from "@/platform/audit/http-handler";
import { auditHttpDependencies } from "@/composition/audit";

export async function GET(request: NextRequest) {
  return handleAuditGet(request, auditHttpDependencies());
}

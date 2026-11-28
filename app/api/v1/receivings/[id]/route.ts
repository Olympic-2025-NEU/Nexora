// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { receivingRoute } from "@/contexts/trading";
export const GET = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  receivingRoute(request, (await params).id);
export const PATCH = GET;

// SPDX-License-Identifier: AGPL-3.0-only
import { timed } from "./health";
import { prisma } from "@/platform/persistence/prisma";

export async function databaseReady() {
  try {
    await timed(prisma.$queryRaw`SELECT 1`);
    return true;
  } catch { return false; }
}

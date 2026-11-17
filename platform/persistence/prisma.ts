// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { nexoraPrisma?: PrismaClient };

/** Singleton PrismaClient for the ERP app process. */
export const prisma =
  globalForPrisma.nexoraPrisma ??
  new PrismaClient({
    log: [],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.nexoraPrisma = prisma;
}

// SPDX-License-Identifier: AGPL-3.0-only
import { auditHttpDependencies } from "@/composition/audit";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createRetryHandlers } from "@/platform/operations/http-handler";

export const { GET, POST } = createRetryHandlers(() => ({
  resolveActor: auditHttpDependencies().resolveActor,
  db: getPrismaClient(),
}));

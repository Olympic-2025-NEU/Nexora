// SPDX-License-Identifier: AGPL-3.0-only
import { auditHttpDependencies } from "@/composition/audit";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createFederationOperationsHandlers } from "@/platform/operations/federation-http";

export const { GET, POST } = createFederationOperationsHandlers(() => ({
  resolveActor: auditHttpDependencies().resolveActor,
  db: getPrismaClient(),
}));

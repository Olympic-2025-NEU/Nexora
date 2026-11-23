// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";
import { TRADING_EVENT_TYPES } from "../contracts/events/registry";
import { createTraceProjector } from "../contexts/traceability/application/trace-projector";
import { createPrismaTraceProjectorPort } from "../contexts/traceability/infrastructure/projector-repos";
export { traceLag } from "../contexts/traceability/infrastructure/lag";

export function traceConsumers(app: PrismaClient, core: PrismaClient, issuerInstanceId: string) {
  const consume = createTraceProjector(createPrismaTraceProjectorPort(app, core, issuerInstanceId));
  return new Map(Object.values(TRADING_EVENT_TYPES).map((eventType) => [eventType, consume]));
}

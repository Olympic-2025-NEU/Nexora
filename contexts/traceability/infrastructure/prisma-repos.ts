// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import { makeLocalTraceEvent, makeTraceLink } from "../domain/provenance";
import type { TraceWritePort } from "../application/port";

export function createTraceRepository(tx: Prisma.TransactionClient): TraceWritePort {
  return {
    async appendLocalEvent(input) {
      const event = makeLocalTraceEvent(input);
      const row = await tx.traceEvent.create({ data: { ...event,
        summary: event.summary as Prisma.InputJsonValue } });
      return { id: row.id, checksumHex: row.checksumHex };
    },
    async appendLink(input) {
      const link = makeTraceLink(input);
      const row = await tx.traceLink.create({ data: { ...link,
        missingRef: link.missingRef as Prisma.InputJsonValue | undefined } });
      return { id: row.id };
    },
    async findLocalSource(documentId, batchId, eventType) {
      const row = await tx.traceEvent.findFirst({ where: {
        documentId, batchId, eventType, verificationState: "local_verified",
      }, select: { id: true, checksumHex: true, externalEventId: true } });
      return row;
    },
  };
}

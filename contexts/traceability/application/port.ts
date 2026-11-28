// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalTraceEventInput, TraceLinkInput } from "../domain/provenance";

/** Append-only provenance boundary used by the P08-T02 projector. */
export interface TraceWritePort {
  appendLocalEvent(input: LocalTraceEventInput): Promise<{ id: string; checksumHex: string }>;
  appendLink(input: TraceLinkInput): Promise<{ id: string }>;
  findLocalSource(documentId: string, batchId: string, eventType: string): Promise<{
    id: string; checksumHex: string; externalEventId: string;
  } | null>;
}

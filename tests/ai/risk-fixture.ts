// SPDX-License-Identifier: AGPL-3.0-only
import type { RiskFactBundle } from "@/contexts/ai/application/risk-rules";

export const RISK_FIXTURE = {
  asOf: "2026-11-26T00:00:00.000Z",
  nearExpiry: "11111111-1111-4111-8111-111111111111",
  noExpiry: "22222222-2222-4222-8222-222222222222",
  discrepancy: "33333333-3333-4333-8333-333333333333",
  partner: "44444444-4444-4444-8444-444444444444",
  clean: "55555555-5555-4555-8555-555555555555",
  sent: "66666666-6666-4666-8666-666666666666",
  received: "77777777-7777-4777-8777-777777777777",
  event: "88888888-8888-4888-8888-888888888888",
  expiresNear: "2026-12-08T00:00:00.000Z",
  expiresFar: "2027-12-08T00:00:00.000Z",
} as const;

function lot(batchId: string, expiresOn: string | null): RiskFactBundle {
  return {
    facts: [
      ...(expiresOn ? [{ kind: "expiresOn", value: expiresOn, sourceId: batchId }] : []),
      { kind: "qualityStatus", value: "available", sourceId: batchId },
    ],
    batchId,
    expiresOn,
    qualityStatus: "available",
    unit: "CAI",
    verification: "local_verified",
    gaps: [],
  };
}

function withPair(bundle: RiskFactBundle, sent: string, received: string): RiskFactBundle {
  return { ...bundle, facts: [...bundle.facts,
    { kind: "sentQuantity", value: sent, sourceId: RISK_FIXTURE.sent },
    { kind: "receivedQuantity", value: received, sourceId: RISK_FIXTURE.received },
    { kind: "unit", value: "CAI", sourceId: bundle.batchId ?? "" },
  ] };
}

const partnerLot = withPair(lot(RISK_FIXTURE.partner, RISK_FIXTURE.expiresFar), "8.000", "8.000");

export const riskFixtures = {
  nearExpiry: lot(RISK_FIXTURE.nearExpiry, RISK_FIXTURE.expiresNear),
  noExpiry: lot(RISK_FIXTURE.noExpiry, null),
  discrepancy: withPair(lot(RISK_FIXTURE.discrepancy, RISK_FIXTURE.expiresFar), "8.000", "6.000"),
  partnerAsserted: { ...partnerLot, verification: "partner_asserted",
    facts: [...partnerLot.facts, { kind: "verificationState", value: "partner_asserted",
      sourceId: RISK_FIXTURE.event, verification: "partner_asserted" }],
  },
  clean: withPair(lot(RISK_FIXTURE.clean, RISK_FIXTURE.expiresFar), "8.000", "8.000"),
} satisfies Record<string, RiskFactBundle>;

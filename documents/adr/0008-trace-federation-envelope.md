# D08 — Trace and federation envelope v1

- **Status:** Accepted for P00 design, 2026-11-17; two-instance behavior remains P09.
- **Blocks:** P08 trace projections and P09 federation.
- **Decision owners:** Dev/team; two G00 reviewers still required.
- **Detailed rationale:** [D08-federation-envelope.md](./D08-federation-envelope.md).

## Decision

The v1 envelope has `schemaVersion='1.0'`, separate business `eventId` and transport `messageId`, authenticated issuer/recipient, event/publish timestamps, immutable origin lot, sender batch, source line, upstream references, evidence references and sharing policy. Decimal quantities are strings. Technical HTTP ACK means inbox persistence only; a user-confirmed receiving business event changes stock. Retry keeps the same message ID/payload; inbox dedupes by issuer/message ID and event key, and a reused message ID with another JCS SHA-256 hash returns 409. No private URL or raw upstream buyer data crosses an unapproved sharing boundary.

This is a wire/data contract; no new container image is selected here. M2M transport is [D05](./0005-federation-trust-m2m.md), storage/DB pins are in D01/D03/D04/D13.

## P00 evidence and boundary

- [x] JSON Schema for envelope and three event types validates A→B transfer, partial/zero receiving, B→C and downstream relay; invalid version, private field, issuer/recipient and quantity cases are rejected.
- [x] Seven fixed JCS hashes and three retry vectors agree between Node and independent Python for the v1 envelope subset. See [contract validation](../phase-plan/evidence/contract-validate.md).
- [x] OpenAPI specifies a 202 technical ACK without receiving quantities and a separate `receipt.confirmed.v1` event. Public passport fields are allowlisted.
- [ ] Runtime: persist/replay the original ACK, emit 409 on conflicting hash/event key, handle offline/out-of-order and policy-denied gap, and run A→B→C with actual 10/12. Owner: P09. The static vectors do not exercise an inbox or remote service.

Contract sources: [event payloads](../phase-plan/event-payloads-v1.md), [envelope schema](../../contracts/events/envelope-v1.schema.json), [fixtures](../../contracts/events/fixtures/manifest-v1.json). G00 still awaits human sign-off.

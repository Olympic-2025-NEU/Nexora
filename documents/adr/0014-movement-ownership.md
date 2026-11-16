# D14 — Stock movement ownership

- **Status:** Accepted-provisional
- **Blocks:** P00/P07
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Only these confirms change stock: GoodsReceipt (+), GoodsIssue (-), ReceivingConfirmation (+actual), Stocktake (+/- variance). PartnerTransfer and SaleRecord reference an existing GoodsIssue and must not create a second movement. One outbound issue <-> one transfer matching lot/qty in MVP.

## Pin fields (fill after spike)

| Field | Value |
| --- | --- |
| image / package version | TBD-until-spike |
| digest | TBD-until-spike |
| license | TBD-until-spike |
| source URL | TBD-until-spike |
| RAM (measured) | TBD-until-spike |
| Owner for spike | Dev |

## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- G00 remains **open** while Spike evidence is pending for gate-critical ADRs (especially D01–D08, D14, D15).

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike evidence: pending

- [ ] Double-confirm same key
- [ ] Transfer after issue: movement count unchanged
- [ ] SaleRecord: no movement
- [ ] Receiving actual 0: no +movement

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

# D05 — Federation trust (M2M)

- **Status:** Accepted-provisional
- **Blocks:** P02/P05
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Receiver issues confidential client/service account for each partner in the receiver realm. Short-lived client-credentials tokens. Partner binding by client_id/scope in app DB — never trust org/instance id from request body alone. A/B/C credentials and DBs remain independent.

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

- [ ] Wrong client -> 401/403
- [ ] Mapped partner accepts envelope
- [ ] Body spoofing issuerInstanceId rejected
- [ ] Independent realms for A/B/C

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

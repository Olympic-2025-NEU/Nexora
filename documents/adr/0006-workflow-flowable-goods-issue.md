# D06 — Workflow = Flowable goods-issue-approval

- **Status:** Accepted-provisional
- **Blocks:** P04/P07
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Flowable OSS REST + dedicated PostgreSQL. BPMN process goods-issue-approval applies to every GoodsIssue v1. Approver != creator. App owns document state; bridge/poller reconciles. No H2 or default demo passwords in release. Spec: workflow-spec-v1.md (BPMN XML deferred until spike).

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

- [ ] Deploy BPMN; start process
- [ ] Complete approve/reject
- [ ] App state after poller
- [ ] Restart/idempotent bridge; pin version/digest

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

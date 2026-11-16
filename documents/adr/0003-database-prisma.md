# D03 — Database adapter = Prisma

- **Status:** Accepted-provisional
- **Blocks:** P00/P03
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Prisma Client + Prisma Migrate only on PostgreSQL. Singleton at platform/persistence. Interactive prisma.$transaction passes Prisma.TransactionClient into repositories. No Drizzle or parallel pg Pool migration runner. $queryRaw only tagged/parameterized when a later ADR allows report/CTE. See prisma-migration-spec.md.

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

- [ ] Mini schema: document + movement + audit + outbox
- [ ] Rollback on injected failure mid-TX
- [ ] Optimistic version via updateMany where version
- [ ] Concurrent stock contention test

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

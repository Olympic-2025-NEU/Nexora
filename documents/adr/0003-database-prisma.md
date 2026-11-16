# D03 — Database adapter = Prisma

- **Status:** Accepted
- **Blocks:** P00/P03
- **Date:** 2026-11-16
- **Decision owners:** Dev (spike completed)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`
- **Evidence:** [`documents/phase-plan/evidence/spike-d03.md`](../phase-plan/evidence/spike-d03.md)

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks.

## Decision

Prisma Client + Prisma Migrate only on PostgreSQL. Singleton at `platform/persistence`. Interactive `prisma.$transaction` passes `Prisma.TransactionClient` into repositories. No Drizzle or parallel `pg` Pool migration runner. `$queryRaw` only tagged/parameterized when a later ADR allows report/CTE. See `prisma-migration-spec.md`.

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | `postgres:17.6`; `prisma` / `@prisma/client` **6.19.0** |
| digest | `postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` |
| license | Prisma Apache-2.0; PostgreSQL PostgreSQL License |
| source URL | https://www.prisma.io/ ; https://www.postgresql.org/ |
| RAM (measured) | ~37 MiB idle for spike PG container |
| Owner for spike | Dev |

## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Full MVP tables still land in P01+; current `spike_*` models are evidence-only.
- G00 still requires other ADR spikes (D01/D02/D04/…).

## Contract impact

- `database-schema-v1.md` + `prisma-migration-spec.md` remain SoT for production tables.
- Spike migration proves multi-schema + Decimal(20,3) + version pattern.

## Spike evidence: complete

- [x] Mini schema: document + movement + audit + outbox
- [x] Rollback on injected failure mid-TX
- [x] Optimistic version via updateMany where version
- [x] Concurrent stock contention test

**Evidence links:** [spike-d03.md](../phase-plan/evidence/spike-d03.md), `scripts/spikes/d03-prisma-tx.ts`, `prisma/migrations/20261116150259_d03_spike_tx/`

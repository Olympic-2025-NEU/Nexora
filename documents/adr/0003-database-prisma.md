# D03 — Database adapter = Prisma

- **Status:** Accepted (**chốt cuối** 2026-11-17)
- **Blocks:** P00/P03 / P01 migration path
- **Date:** 2026-11-16 (spike); **locked:** 2026-11-17
- **Decision owners:** Dev / team
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`
- **Evidence:** [`documents/phase-plan/evidence/spike-d03.md`](../phase-plan/evidence/spike-d03.md)

## Context

Nexora cần một SoT persistence trước khi merge các nhánh P00 song song. Có hai bằng chứng TX cạnh tranh: Prisma (`spike/d03-prisma`) và `pg`+SQL (`phase-00/baseline-t03`). Đội **chốt Prisma**.

## Decision (final)

**Prisma Client + Prisma Migrate** là stack duy nhất trên PostgreSQL.

- Singleton: `platform/persistence/prisma.ts`
- TX: `prisma.$transaction` → truyền `Prisma.TransactionClient` vào repository/port
- **Cấm:** Drizzle; `pg` `Pool`/`PoolClient` song song làm migration/app data access; hai migration runners
- `$queryRaw` / `$executeRaw`: chỉ tagged template / bind values khi ADR cho phép report/CTE
- Spec: `documents/phase-plan/prisma-migration-spec.md`

## Supersedes

| Artifact | Branch / path | Xử lý |
| --- | --- | --- |
| ADR `pg` + SQL / PoolClient | `phase-00/baseline-t03` → `documents/adr/D03-database-transaction-migrations.md` | **Superseded** — không dùng làm baseline P01 |
| Spike `pg` isolated | `documents/phase-plan/evidence/spikes/d03/` trên phase-00 | Giữ như **tham chiếu semantics** (rollback/concurrency); không chọn adapter |
| Empty `db/migrations/*.sql` runner | legacy | Thay bằng Prisma Migrate ở P01 |

Khi merge `phase-00/baseline-t03` vào `develop`: đổi/xóa ADR `D03-database-*` kiểu `pg`, giữ infra spikes D01/D02/D04/D06…, đồng bộ decision-log về Prisma.

## Pin fields (from Prisma spike)

| Field | Value |
| --- | --- |
| image / package version | `postgres:17.6`; `prisma` / `@prisma/client` **6.19.0** |
| digest | `postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` |
| license | Prisma Apache-2.0; PostgreSQL PostgreSQL License |
| source URL | https://www.prisma.io/ ; https://www.postgresql.org/ |
| RAM (measured) | ~37 MiB idle for spike PG container |
| Owner | Dev |

## Consequences

- P01+ viết `prisma/schema.prisma` + Migrate theo `database-schema-v1.md`.
- Repository chỉ nhận `PrismaClient` | `Prisma.TransactionClient`.
- G00 vẫn mở cho D01/D02/D04+; D03 persistence **đã chốt**.

## Contract impact

- SoT bảng: `database-schema-v1.md`
- SoT migrate: `prisma-migration-spec.md`
- Không mở ADR mới để chọn lại `pg` trừ khi spike Prisma bị bác bằng bằng chứng mới + ADR superseding.

## Spike evidence: complete

- [x] Mini schema: document + movement + audit + outbox
- [x] Rollback on injected failure mid-TX
- [x] Optimistic version via updateMany where version
- [x] Concurrent stock contention test

**Evidence links:** [spike-d03.md](../phase-plan/evidence/spike-d03.md), `scripts/spikes/d03-prisma-tx.ts`, `prisma/migrations/20261116150259_d03_spike_tx/`

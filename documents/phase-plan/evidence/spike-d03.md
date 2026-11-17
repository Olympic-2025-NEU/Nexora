# Spike D03 — Prisma TX evidence

**Date:** 2026-11-16  
**Locked as SoT:** 2026-11-17 (**chốt Prisma** — supersedes phase-00 `pg`+PoolClient ADR)  
**Status:** PASS  
**Command:** `npm run spike:d03` (after `prisma migrate deploy`)

## Environment

| Item | Value |
| --- | --- |
| `@prisma/client` / `prisma` | 6.19.0 (Apache-2.0) |
| PostgreSQL image | `postgres:17.6` |
| Image digest | `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` |
| PG container RAM (idle) | ~37 MiB |
| Host DB URL | `127.0.0.1:5433` (5432 occupied by another local PG) |
| Migration | `prisma/migrations/20261116150259_d03_spike_tx` |
| Script | `scripts/spikes/d03-prisma-tx.ts` |
| Client singleton | `platform/persistence/prisma.ts` |
| TX port | `platform/persistence/transaction.ts` |

## Results

```text
PASS rollback_mid_tx: all four tables empty after rollback
PASS optimistic_version: second updateMany count=0 (409 path); version=2
PASS concurrent_stock_contention: one issue committed (qty 8), balance=2, one failure
D03_SPIKE_OK
```

`prisma migrate deploy` on already-migrated DB: **No pending migrations to apply.**

## Checklist

- [x] Mini schema: document + movement + audit + outbox (`spike_*` in platform/inventory/trading)
- [x] Rollback on injected failure mid-TX
- [x] Optimistic version via `updateMany` where version
- [x] Concurrent stock contention test

## Notes for P01

- Spike tables are **not** production MVP schema; replace/extend per `database-schema-v1.md`.
- Prefer host port **5433** in demo docs when developer machines already run PG on 5432.

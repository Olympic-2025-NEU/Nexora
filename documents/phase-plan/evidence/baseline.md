# P00-T01 — Baseline inventory

**Date:** 2026-11-16  
**Commit:** `b51369c99ea85cf34823d54f6ad76d7183ebf1d3`  
**Branch:** `docs/plan_improvement`  
**Owner:** Dev  
**Status:** Inventory only — **not** module Done. No `[x]` on phase tasks from this file alone.

## Environment captured

| Tool | Version / note |
| --- | --- |
| Node | v24.15.0 |
| npm | 11.12.1 |
| Docker Compose | Present; `config` **failed** — `deploy/.env` missing (see Command logs) |
| OS | Windows |

## package.json (as of inventory)

- **Scripts:** `dev`, `build`, `start`, `lint` only — **missing** `typecheck`, `test`, `db:migrate`.
- **Dependencies:** `next@16.4.6`, `react@19.3.0`, `react-dom@19.3.0`.
- **DevDependencies:** Tailwind 4.3.3, ESLint/Next, TypeScript 5, `@types/*`.
- **Not present:** `prisma`, `@prisma/client`, Zod, test runner, Keycloak/Flowable clients.

## Tree (relevant, non-node_modules)

```text
nexora/
  app/
    api/v1/health/route.ts     # static JSON ok — not live/ready contract
    layout.tsx, page.tsx       # Next starter
  components/shell/areas.ts
  composition/context-map.ts
  contexts/
    finance/                   # LEGACY scaffold — out of Ch6
    inventory/                 # only reservation guard
    master-data/               # LEGACY
    procurement/               # LEGACY
    sales/                     # LEGACY
    # missing: system, catalog, trading, traceability, federation
  platform/                    # ports/types only — no real adapters
    access/, audit/, files/, http/, identity/, kernel/
    outbox/, persistence/, tenancy/, workflow/
  db/migrations/0001_platform.sql   # 0 bytes
  deploy/docker-compose.yml         # postgres:17 only; mounts empty SQL
  documents/                        # referents + phase-plan rich
  # missing at inventory time: prisma/, contracts/, documents/adr/, .github/,
  #   services/core-data/, services/ai/, apps/dx-lab/, workers/
```

## Facts that must not be overstated

| Fact | Evidence |
| --- | --- |
| Health is static | `GET` returns `{status:"ok", platform, contexts}` — not dependency readiness |
| Migration empty | `0001_platform.sql` length **0** |
| Compose = PG only | Single `postgres` service; no Keycloak/gateway/Redis/storage/Flowable |
| Legacy contexts | `sales|finance|procurement|master-data` still present |
| SaaS-like tenancy stub | `platform/tenancy/tenant.ts` still exists (conflicts single-org SoT) |
| No Prisma materialize | No `prisma/schema.prisma` |
| No machine-readable contracts | No `contracts/` at start of this inventory (docs package may add in same P00 docs PR) |
| No CI workflow | No `.github/workflows/` |
| No ADR directory | No `documents/adr/` at start of inventory |

## Command logs

### `docker compose -f deploy/docker-compose.yml config`

```text
FAIL — env file E:\Working\Nexora\nexora\deploy\.env not found
```

**Blocker for Dev:** create `deploy/.env.example` (no secrets) and local `.env` (gitignored) before Compose validation. Owner: Dev. Outside 1A docs-only scope to invent secrets.

### `npm ci` / `npm run lint` / `npm run build`

**Not re-run in this docs package** (avoid long install in evidence-only pass). Dev must capture on a clean clone:

```bash
npm ci
npm run lint
npm run build
```

Record exit codes and first failure lines into this file or a follow-up `evidence/baseline-commands.md`.

## Gaps → P00 follow-ups

1. ADR spike evidence (D01–D08, D14, D15) — see `documents/adr/`.
2. `deploy/.env.example` + Compose multi-service (P01, after G00).
3. Prisma Migrate replace empty SQL (P01).
4. CI + SPDX on sources (P00-T04/T06 runtime — checklist only in this package).
5. Replace/deprecate legacy contexts per `scaffold-mapping.md`.

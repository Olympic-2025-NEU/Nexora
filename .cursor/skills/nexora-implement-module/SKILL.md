---
name: nexora-implement-module
description: >-
  Implements a Nexora MVP module from its plan file. Use when starting or coding
  Platform, M01, M02, M03, M04, or AI01; when the user names a module plan; or when
  scaffolding contexts for Chapter 6 features.
---

# Implement Nexora module

## Before coding

1. Read `documents/referents/SOURCE_OF_TRUTH.md`.
2. Read `documents/phase-plan/README.md` and the **TASK_ID** in the relevant `phase-xx-*.md` (plus AI dossier at file end). Do not implement from `documents/plans/` overview alone.
3. Read module plan under `documents/plans/` for scope/AC context.
4. Read `FOLDER_STRUCTURE.md`, `CODING_RULES.md`, `MVC_DDD_LAYERING.md`, `PLATFORM_CAPABILITIES.md`.
5. Read contracts touched: `prisma-migration-spec.md`, `database-schema-v1.md`, `api-contracts.md` / `api-payloads-v1.md`, `security.md` when authz/XSS/CSRF/SQLi applies.
6. Confirm earlier phase gates / ADR dependencies; if blocked, stop and report.

## Implementation order inside a module

1. Domain aggregates + invariants (no I/O, no Prisma types as aggregate).
2. Application use cases + ports.
3. Prisma schema/migration for the module (Migrate only; no parallel SQL runner).
4. Infrastructure repositories using `PrismaClient` | `TransactionClient`.
5. Wire in `composition/`.
6. Thin `app/api/v1/...` routes under the feature cluster tree (no catch-all).
7. Minimal UI screens listed in the plan.
8. Tests: unit + integration TX/rollback or API authz as listed; security cases if mutating/public.

## Done checks

- Plan “Tiêu chí Done” / phase gate evidence and linked AC-* from `ACCEPTANCE_MVP.md`.
- No imports that violate context boundaries; no `prisma` in route/domain.
- No MVP-out-of-scope features silently added.

## Out of scope unless plan says so

Finance, CRM, full POS, multi-tenant SaaS, Quality multi-step, Workflow builder, BI report builder.

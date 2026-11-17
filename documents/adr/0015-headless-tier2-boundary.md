# D15 — Headless core vs tier-2/3 apps

- **Status:** Accepted (spike evidence linked 2026-11-17)
- **Blocks:** P00/P01
- **Date:** 2026-11-16
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Core Data/File API (services/core-data) is headless — no UI. ERP Next.js owns document/stock/audit/outbox transactions on app DB. DX-Lab is separate frontend runtime. Smoke: core endpoints work with both UIs stopped. platform/ TypeScript ports are not proof that PaaS services exist.

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | core_spike Python service (scratch DB) |
| digest | local spike image; not product core-data |
| license | AGPL-3.0-only for Nexora; deps per requirements-core.txt |
| source URL | documents/phase-plan/evidence/spikes/infra/ |
| RAM (measured) | core ~27.7 MiB + core DB ~59 MiB snapshot |
| Owner for spike | Dev |


## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike evidence

- [x] Headless core without UI
- [x] Auth on core routes
- [x] Survives upstream stop
- [x] Product Core Data/File API still P01/P03

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D15-headless-core-boundary.md

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

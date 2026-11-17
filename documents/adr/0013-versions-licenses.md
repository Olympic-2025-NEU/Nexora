# D13 — Versions and licenses

- **Status:** Accepted-provisional
- **Blocks:** P01/P13
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Pin image digests and lockfiles; maintain SBOM/license inventory. Verify OSS licenses for Flowable, gateway, storage, AI SDK. No enterprise-only components that cannot be built from source for contest rebuild.

## Pin fields

Canonical table (spike + **P01-T01 Compose pins** including Redis/ClamAV/Postgres 17.6): [`D13-versions-licenses-resources.md`](./D13-versions-licenses-resources.md). Deploy entrypoint: [`deploy/compose.yml`](../../deploy/compose.yml). Inventory: [`evidence/license-inventory.md`](../phase-plan/evidence/license-inventory.md).

| Field | Value |
| --- | --- |
| image / package version | See D13 evidence table |
| digest | See D13 evidence table |
| license | See D13 + license-inventory |
| source URL | See D13 evidence table |
| RAM (measured) | Spike snapshots in D13; full-stack peak still P01/P12 |
| Owner for spike | Dev |

## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- G00 remains **open** while Spike evidence is pending for gate-critical ADRs (especially D01–D08, D14, D15).

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike / Compose evidence

- Spike RAM/digest: `D13-versions-licenses-resources.md`
- P01-T01 topology: `documents/phase-plan/evidence/p01-t01-compose.md`
- Image licenses in deploy Compose: `documents/phase-plan/evidence/license-inventory.md`

## Remaining before release (P13)

- [x] Pin infra images used by `deploy/compose.yml` (no `latest`)
- [ ] Full SBOM / transitive image layer inventory for distributed artifacts
- [ ] Reject incompatible licenses in the **shipped** artifact set
- [ ] Peak RAM for full A/B/C + ClamAV demo machine

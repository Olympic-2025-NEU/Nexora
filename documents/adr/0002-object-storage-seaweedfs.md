# D02 — Object storage (SeaweedFS S3)

- **Status:** Accepted (spike evidence linked 2026-11-17)
- **Blocks:** P01/P03
- **Date:** 2026-11-16
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Self-host S3-compatible storage. Baseline candidate: SeaweedFS (Apache-2.0) with buckets quarantine/private/public per instance. Re-evaluate MinIO Community only if distribution/license allows reproducible builds at spike time.

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | SeaweedFS 4.53 (spike) |
| digest | see D02-object-storage.md / infra README |
| license | Apache-2.0 |
| source URL | https://github.com/seaweedfs/seaweedfs |
| RAM (measured) | see D13 / infra README |
| Owner for spike | Dev |


## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike evidence

- [x] Upload/download private S3
- [x] Presigned URL
- [x] Restart persistence + logical restore SHA-256
- [x] Source build attempted (Apache-2.0)

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D02-object-storage.md

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

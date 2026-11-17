# D01 — API Gateway (Apache APISIX)

- **Status:** Accepted-provisional
- **Blocks:** P01/P02
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Use Apache APISIX as default-deny API Gateway with OIDC plugin integrated with Keycloak; separate route classes for public, authenticated user, and M2M federation. Do not replace with a reverse proxy that only rewrites URLs.

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

- [ ] Compose APISIX (+ etcd if required) with pinned image/digest
- [ ] Route matrix: /api/v1/public/* anonymous; /api/v1/* user; /api/v1/federation/* M2M
- [ ] Prove 200/401/403; app not reachable bypassing gateway
- [ ] Measure RAM; record license/source URL

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

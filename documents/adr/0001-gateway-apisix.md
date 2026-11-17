# D01 — API Gateway (Apache APISIX)

- **Status:** Accepted (spike evidence linked 2026-11-17)
- **Blocks:** P01/P02
- **Date:** 2026-11-16
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Use Apache APISIX as default-deny API Gateway with OIDC plugin integrated with Keycloak; separate route classes for public, authenticated user, and M2M federation. Do not replace with a reverse proxy that only rewrites URLs.

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | apache/apisix:3.20.0-debian |
| digest | sha256:013de62a9dfba7d8e6006b3e85b524c28c9f1c3549fca3b91d5b258b0b9e759a |
| license | Apache-2.0 |
| source URL | https://github.com/apache/apisix |
| RAM (measured) | ~358 MiB snapshot (spike infra) |
| Owner for spike | Dev |


## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike evidence

- [x] Compose APISIX standalone YAML (spike infra)
- [x] Route matrix public/user/M2M 200/401/403
- [x] OIDC PKCE + required_scopes
- [x] RAM/license recorded in D01-api-gateway.md

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D01-api-gateway.md

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

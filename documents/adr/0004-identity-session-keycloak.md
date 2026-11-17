# D04 — Identity and session (Keycloak)

- **Status:** Accepted (spike evidence linked 2026-11-17)
- **Blocks:** P02
- **Date:** 2026-11-16
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Keycloak OIDC. Browser: authorization-code + PKCE. App re-validates token/claims and applies DB membership RBAC (administrator/staff/approver/viewer). Gateway enforces route auth. Session/BFF cookie + CSRF policy must follow Next.js 16 docs in node_modules when coding (SameSite, CSRF token or double-submit per security.md).

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | Keycloak (spike stack; pin in D04 evidence) |
| digest | see D04-identity-session.md |
| license | Apache-2.0 |
| source URL | https://www.keycloak.org/ |
| RAM (measured) | see D13 / infra README |
| Owner for spike | Dev |


## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- The current target API/auth matrix is `contracts/openapi/nexora-v1.yaml`; BFF/session and membership enforcement remain P02 runtime work.

## Spike evidence

- [x] PKCE happy path + wrong verifier
- [x] OIDC via gateway
- [x] sub mapper lesson recorded
- [x] P02 still owns HTTPS issuer/session cookie production

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D04-identity-session.md

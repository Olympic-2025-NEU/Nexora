# D04 — Identity and session (Keycloak)

- **Status:** Accepted-provisional
- **Blocks:** P02
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Keycloak OIDC. Browser: authorization-code + PKCE. App re-validates token/claims and applies DB membership RBAC (administrator/staff/approver/viewer). Gateway enforces route auth. Session/BFF cookie + CSRF policy must follow Next.js 16 docs in node_modules when coding (SameSite, CSRF token or double-submit per security.md).

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

- [ ] Login PKCE happy path
- [ ] Expired/wrong audience -> 401
- [ ] CSRF missing token -> 403 on cookie mutative call
- [ ] No secrets in browser logs

**Evidence links:** _(none yet — Dev attaches logs/commits here)_

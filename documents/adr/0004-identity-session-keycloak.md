# D04 — Identity and session (Keycloak)

- **Status:** Accepted — updated P02-T01 (2026-11-18)
- **Blocks:** P02
- **Date:** 2026-11-16 · revised 2026-11-18
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

**Bearer API auth — authorization-code + PKCE only to obtain tokens.**

- Browser clients (ERP, DX-Lab) obtain tokens via authorization-code + PKCE flow.
- All API calls carry a **Bearer token** in the `Authorization` header; no cookie session on the API layer.
- CSRF is **not applicable** for pure Bearer endpoints (no session cookie). CSRF protection is documented in `security.md` for any future BFF/cookie endpoints only.
- **MFA is required for `administrator` and `approver` roles.** Keycloak enforces `CONFIGURE_TOTP` as a required action on those users. Staff and viewer roles do not require MFA by default.
- App re-validates token claims (issuer, audience, expiry) and applies DB membership RBAC (`administrator`/`staff`/`approver`/`viewer`). Gateway enforces route auth.
- `organizationId` (formerly `tenantId`) comes exclusively from the DB membership row; never from the token body or request payload.

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | Keycloak (spike stack; pin in D04 evidence) |
| digest | see D04-identity-session.md |
| license | Apache-2.0 |
| source URL | https://www.keycloak.org/ |
| RAM (measured) | see D13 / infra README |
| Owner for spike | Dev |
| JWKS verify library | `jose` (npm) — RFC 7517 JWKS, RFC 7519 JWT |

## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.
- `TenantId`/`tenantId` are replaced by `OrganizationId`/`organizationId` across `platform/*` and all contexts; see P02-T01 migration.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Bearer token flow: `Authorization: Bearer <access_token>` on all `/api/v1/*` private routes.
- Gateway (APISIX) uses confidential client `gateway-oidc` for token introspection.
- `platform/identity/token.ts` — `verifyBearerToken()` via `jose` JWKS; `platform/identity/resolve-actor.ts` — membership DB lookup.
- `system.organization` and `system.membership` schemas introduced in P02-T01 (pulled forward from P05 design).

## Spike evidence

- [x] PKCE happy path + wrong verifier
- [x] OIDC via gateway
- [x] sub mapper lesson recorded
- [x] P02-T01 Bearer + MFA policy implemented; gateway-oidc confidential client added
- [x] CONFIGURE_TOTP required action for administrator/approver bootstrap users

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D04-identity-session.md + ../phase-plan/evidence/p02-t01.md

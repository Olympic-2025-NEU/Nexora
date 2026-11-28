# Changelog

Các thay đổi của Nexora sẽ được ghi tại đây. Tag contest/semver chỉ tạo khi owner chốt tên (P13-T06).

Product semver source of truth: root `package.json` (`0.1.0`). Suggested git tag: `v0.1.0`.

## Unreleased

### Phase 13 — Release / nghiệm thu (P13-T01–T09 / G13)

- Freeze AC/PoF traceability (`documents/phase-plan/evidence/release-traceability.md`); known limitations register.
- Security refresh (`test:security:p12`, `check:secrets`) and AGPL SPDX/license inventory re-verify.
- Clean-install and deploy runbooks; E2E A→B→C journey script; demo 15m runbook; submission checklist (BTC fields owner-owned).
- Release artifact prep (`npm run prep:release-archive` → source `.tar.gz` + sha256); **no git tag until user confirms tag name**.
- Gate package `evidence/G13.md` — conditional release-ready if BTC/AC-13 second-person/submission receipt still open.

## [0.1.0] — contest candidate

- Product semver wired from `package.json` into build env (`NEXT_PUBLIC_APP_VERSION`), SystemHeader chip, health responses, and release archive meta.
- Shared UI: DateTimePicker + declarative ListFilters for reusable list search/filter bars.

### Phase 06 — M02 Catalog & Inventory (P06-T01–T08 / G06)

- Schema pack Dev-approved (`evidence/p06-schema-design.md`); Prisma migrations `catalog` + `inventory` + `membership_warehouse` with `app_runtime` GRANTs.
- Quantity D07 (`contexts/catalog/domain/quantity.ts`); Inventory port `adjustStock` / `openStockBalance`.
- APIs/UI: products, batches, warehouses, inventory balances/movements; member `warehouseIds` scope.
- Seed `deploy/scripts/seed-catalog.mjs`; gate `evidence/G06.md` CLOSED (AC-03 waits P07).
- Follow-up fixes: `INSTANCE_ID` on erp Compose; audit keeps warehouseIds/reason; member warehouse UUID validation; expiry uses org timezone; seed create-if-missing; movement delta-sign CHECK; adjustStock replay/P2002/EA harden.

### Phase 05 — M01 System & Partner (P05-T01–T08 / G05)

- Plan updated: no duplicate system migrations; admin-invite membership; T03 scoped to M01; T06 ≠ P09 inbox.
- New `contexts/system` + `composition/system.ts`; APIs `/organization`, `/members`, `/partners`, `/partners/{id}/connection`.
- Admin UI under `/admin/*`; seed + `partner-handshake.mjs` + `runbook-m01-provisioning.md`.
- M2M harden (`partner-actor` partner status/scope) + `/api/v1/federation/connectivity` probe route.
- Gate: `evidence/G05.md` CLOSED (technical package).

### Phase 02 — P02-T02 through P02-T08 (identity, gateway, policy, HTTPS, docs)

- **T02 Private routes:** `deploy/apisix/routes.yaml` updated — `core-api-v1` and `files-api-v1` before catch-all `erp-api-v1`; OIDC `bearer_only: true` on all private routes; `serverless-pre-function` strips forged identity headers (`x-userinfo`, `x-access-token`, `x-authenticated-user`, etc.); `limit-req` and `request-id` plugins on all routes.
- **New:** `platform/identity/request-auth.ts` — `authenticate()`, `detectForgedHeaders()`, `authOptionsFromEnv()`, `authErrorResponse()`, `AuthError`.
- **New:** `app/api/v1/me/route.ts` — protected sample route returning safe Actor projection; rejects unauthenticated and policy-denied calls.
- **New:** `tests/gateway/private.test.mjs` — route matrix documentation + header-stripping unit tests + routes.yaml static assertions.
- **T03 Public route:** `app/api/v1/public/passport/[token]/route.ts` — anonymous GET/HEAD only; token format validation; 404 safe stub (no batch ID leak); 405 for POST/PUT/etc.
- **New:** `tests/gateway/public.test.mjs` — public route matrix + token format validation.
- **T04 M2M + partner DB:** Prisma `Partner` + `PartnerConnection` models in `system` schema; migration `20261118010000_system_partner`.
- **New:** `platform/identity/partner-actor.ts` — `resolvePartnerActor()` maps `azp`/`client_id` → active `PartnerConnection`; `PartnerActor` type.
- **New:** `app/api/v1/federation/events/route.ts` and `acks/route.ts` — M2M stubs returning 202 after partner-actor resolution (inbox deferred to P09).
- **New:** `tests/gateway/m2m.test.mjs` — M2M matrix + partner-actor unit tests (mocked DB).
- **T05 App policy:** `platform/access/policy.ts` — `checkPolicy()`, `requirePolicy()`, `PolicyError`; role matrix (administrator/staff/approver/viewer/partner/public × actions); federation endpoints `adminAlwaysAllowed: false`.
- **New:** `platform/audit/security-audit.ts` — `redact()` strips JWT/Bearer/secret patterns; `auditDeny()` / `auditAccess()` structured JSON output; `actorSummary()` safe truncated log.
- **New:** `tests/gateway/policy.test.mjs` — separation-of-duties matrix; staff cannot call admin actions; approver cannot create; partner cannot access user endpoints.
- **T06 HTTPS hardening:** `deploy/apisix/config.yaml` updated — SSL listener on port 9443; `client_max_body_size: 10m`; Compose gateway publishes `127.0.0.1:GATEWAY_HTTPS_PORT:9443`. `deploy/certs/.gitignore` added. `deploy/scripts/gen-local-certs.sh` and `.ps1` for mkcert. `platform/security/ssrf.ts` — HTTPS-only validation, private IP/loopback/internal-hostname blocking for partner URLs.
- **T07 OpenAPI security schemes:** `contracts/openapi/nexora-v1.yaml` — `bearerUser` scheme added; `bearerM2M` and `oidc` descriptions expanded; info section with Bearer/M2M sample redacted claims and 401/403 error codes. `deploy/README.md` expanded with realm/client provisioning runbook, rotate/revoke instructions, HTTPS mkcert link, error codes table.
- **T08 Gate G02:** `evidence/G02.md` closed under owner waiver (Docker daemon unavailable); all unit tests pass; technical package complete. `summary.md` updated.

### Phase 02 — P02-T01 identity core

- **Bearer API auth (D04):** authorization-code + PKCE to obtain tokens; Bearer on all API calls; CSRF N/A for Bearer-only API layer.
- **MFA:** `CONFIGURE_TOTP` required action on `administrator` and `approver` Keycloak users; Staff/Viewer not required.
- **OrganizationId migration:** replaced `TenantId`/`tenantId` with `OrganizationId`/`organizationId` across `platform/kernel/id.ts`, `platform/identity/actor.ts`, `platform/audit/audit-recorder.ts`, `platform/outbox/message.ts`, `platform/files/file-store.ts`, and all legacy contexts (sales, procurement, master-data, finance). `TenantId` retained as deprecated alias.
- **New:** `platform/tenancy/organization.ts` — `Organization` type, `organizationOf()`. `platform/tenancy/tenant.ts` superseded (legacy aliases re-exported).
- **New:** `platform/identity/token.ts` — `verifyBearerToken()` via `jose` (JWKS remote); `TokenError` with HTTP status; `realmRoles()` helper.
- **New:** `platform/identity/resolve-actor.ts` — `resolveActor()` loads membership from DB; `MembershipRepository` port; `ActorResolutionError`.
- **New:** `platform/identity/token.test.ts` — node:test unit tests for token claim validation (valid/expired/wrong issuer/wrong audience/missing Bearer).
- **Prisma:** `schemas = ["platform", "system"]`; `previewFeatures = ["multiSchema"]`; models `Organization` and `Membership` added.
- **Migration:** `20261118000000_system_org_membership` — creates `system` schema, `system.organization` (singleton slot), `system.membership` (keycloak_sub, role, status checks).
- **Keycloak realm:** added `otpPolicy`, `requiredActions` (CONFIGURE_TOTP/VERIFY_EMAIL/UPDATE_PASSWORD), confidential client `gateway-oidc` for APISIX.
- **Bootstrap:** `deploy/keycloak/bootstrap.mjs` — `ensureUser`, `assignRole`, `assignMfaRequiredAction` helpers; optional `KC_ADMIN_*`/`KC_APPROVER_*` env to create MFA users at boot.
- **Docs:** `deploy/certs/README.md` mkcert local HTTPS tutorial; `evidence/p02-t01.md`; ADR 0004 updated; decision-log D04 row updated; security.md CSRF/MFA notes.
- **Added dependency:** `jose` (JWKS/JWT verify).

### Phase 01 runtime

- Synced full P01 runtime package onto `phase-01` (Compose topology, Prisma migrate, bootstraps, health/smoke).
- Closed Gate G01 under owner waiver (technical agent A/B reinstall retained; independent human teammate waived).

### Phase 00 remediation

- Removed unused starter branding and Google font import; recorded source and dependency provenance.
- Added exact SPDX, tracked-secret and lockfile-license checks with generated inventories.
- Added contract validation and CI checks for the Phase 00 gate.

### Tài liệu và giấy phép

- Công bố toàn văn GNU AGPL v3 và metadata `AGPL-3.0-only`.
- Làm rõ ranh giới lõi DX-OS headless và ứng dụng Nexora trong tài liệu kiến trúc.
- Ghi lại yêu cầu bắt buộc của đề thi OLP PMNM 2026, các khoảng trống của scaffold và bộ phase-plan chi tiết Phase 00–13 để nhóm thực thi sau.

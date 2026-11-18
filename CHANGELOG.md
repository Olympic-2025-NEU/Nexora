# Changelog

Các thay đổi của Nexora sẽ được ghi tại đây. Chưa có bản phát hành dự thi.

## Unreleased

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

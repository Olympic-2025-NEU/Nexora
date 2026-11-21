<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Runbook — M01 provisioning (P05)

## Prerequisites

- Stack from `phase-04`/`phase-05` with Keycloak + gateway + PG.
- mkcert HTTPS recommended (`PUBLIC_BASE_URL=https://localhost:19443`).
- Admin/Approver users must complete TOTP (P02 MFA) before G05 UI demo.

## Roles

Use exactly: `administrator` | `staff` | `approver` | `viewer`. Never `admin`.

## Bootstrap organization + membership

```bash
# Inside Compose network or with DATABASE_URL / OIDC_BASE_URL set
node deploy/scripts/seed-system.mjs
```

Optional partner stub (no secrets):

```bash
SEED_PARTNER_ISSUER=https://partner.example/realms/nexora \
SEED_PARTNER_CODE=ORG-B \
SEED_PARTNER_NAME="Partner B" \
node deploy/scripts/seed-system.mjs
```

Seed is idempotent — safe to run twice.

## Admin invite (no open JIT)

1. Create the Keycloak user (Admin Console or admin API) with required actions as needed.
2. `POST /api/v1/members` with `{ keycloakSub, displayName, role }` as Administrator.
3. User without membership receives **403 MEMBERSHIP_NOT_FOUND** even with a valid JWT.

## Partner connection

1. `POST /api/v1/partners` with `issuerInstanceId` (trust id), `code`, `displayName`.
2. `PUT /api/v1/partners/{id}/connection` with HTTPS URLs + `outboundSecretRef` (reference only).
3. SSRF rejects private/loopback/non-HTTPS URLs.
4. Rotate by PUT again — response never returns the secret ref value content beyond status/host.
5. Handshake: `PARTNER_TOKEN=… node deploy/scripts/partner-handshake.mjs`

## Rotate / revoke

- Connection `status=disabled` or partner `status=suspended` blocks M2M (`PARTNER_CONNECTION_INACTIVE` / `PARTNER_SUSPENDED`).
- Outbox rows are not deleted on rotate/revoke.

## Lost admin access

- Protect last active administrator (API returns `LAST_ADMIN_PROTECTED`).
- Recover via DB + Keycloak admin only with change control — never commit passwords.

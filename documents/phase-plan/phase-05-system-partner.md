# Phase 05 — M01 System & Partner

**Mục tiêu:** một doanh nghiệp trên mỗi instance, người dùng nội bộ có vai trò, đối tác được quản lý và kết nối có kiểm soát. **Phụ thuộc:** G02–G04, D04/D05. **Unblock:** catalog, giao dịch và federation. **AC:** AC-02, một phần AC-01/05.

**UI surfaces (ADR 0016, 2026-11-22):** canonical `/admin/organization`, `/admin/members`, `/partners`. Evidence may still cite legacy `/admin/partners` — that path **redirects**. Catalog/inventory must not live under `/admin`.

**Quyết định vận hành (2026-11-21):**
- Membership lifecycle = **admin invite** (không open JIT). JWT hợp lệ nhưng chưa có membership → 403.
- Role enum bắt buộc: `administrator` | `staff` | `approver` | `viewer` (không dùng `admin`).
- Schema `system.organization|membership|partner|partner_connection` đã có từ P02 — **không** tạo migration trùng.
- T06 chỉ harden M2M authz; **inbox/ACK business = P09**.
- G05 prerequisite: Admin/Approver enroll TOTP (P02 MFA) trước demo AC-02 UI.

## P05-T01 — Organization một instance

> **Note (P02-T01):** schema đã có — không migration mới.

- [x] Bootstrap organization qua seed; singleton slot khóa org thứ hai. PATCH có audit + optimistic version.
- [x] API read/update allowlist; Staff manage 403.
- **Đầu ra:** `contexts/system` + `/api/v1/organization` + UI `/admin/organization`. Evidence: `evidence/p05-t01.md`.

## P05-T02 — Membership và vòng đời user

> **Chốt:** admin invite.

- [x] Map Keycloak `sub` → membership DB; role không tin từ body.
- [x] Roles `administrator|staff|approver|viewer`; authz ở app service.
- [x] Invite/assign/disable; last-admin protect; audit.
- **Đầu ra:** `/api/v1/members`. Evidence: `evidence/p05-t02.md`.

## P05-T03 — Chính sách quyền thống nhất

> Scope P05: M01 + `/me` + federation stub.

- [x] Matrix M01 trong `policy.ts` + `security.md`.
- [x] Negative policy tests (staff/admin/partner).
- [x] Không chọn org qua body.
- **Evidence:** `evidence/p05-t03.md`.

## P05-T04 — Danh bạ đối tác

> Schema partner P02 — không migration.

- [x] Registry API/UI; unique issuer; Staff projection hẹp.
- **Evidence:** `evidence/p05-t04.md`.

## P05-T05 — Partner connection

- [x] Inbound/outbound tách; secret ref; SSRF; rotate via PUT; handshake script.
- **Evidence:** `evidence/p05-t05.md`.

## P05-T06 — M2M trust boundary

- [x] Harden partner-actor + connectivity probe; inbox = P09.
- **Evidence:** `evidence/p05-t06.md`.

## P05-T07 — UI / seed / runbook

- [x] Admin UI; idempotent seed; `runbook-m01-provisioning.md`.
- **Evidence:** `evidence/p05-t07.md`.

## P05-T08 — Gate G05

- [x] `evidence/G05.md` — technical package CLOSED; live MFA A/B/C follow-up operator.

## Hồ sơ giao AI theo từng task

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P05-T01 | Consume P02 org schema; `contexts/system` + GET/PATCH organization | Staff PATCH 403; version conflict 409 |
| P05-T02 | Membership APIs; admin invite | Last-admin protected; disable hiệu lực DB |
| P05-T03 | policy.ts M01 keys + tests | m01-policy + gateway policy PASS |
| P05-T04 | Partner CRUD consume P02 schema | Duplicate issuer 409 |
| P05-T05 | Connection PUT + SSRF + handshake | Secret not in response |
| P05-T06 | partner-actor harden + connectivity | Suspended partner 403 |
| P05-T07 | Admin UI + seed + runbook | Seed idempotent |
| P05-T08 | `evidence/G05.md` | Gate CLOSED |

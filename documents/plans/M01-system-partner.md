# Plan: M01 — System & Partner Management

> Plan tổng quan. Chi tiết thi công theo `documents/phase-plan/phase-05-system-partner.md` (P05).

## 1. Mục tiêu / phạm vi MVP

| Mã | Chức năng |
| --- | --- |
| NX-SYS-01 | Organization Profile |
| NX-SYS-02 | User & Access (admin invite) |
| NX-SYS-03 | Federated Partner Management (`system.Partner`) |
| NX-SYS-04 | Partner Connection |

Mỗi instance quản lý một doanh nghiệp, tài khoản, đối tác liên instance và thông tin kết nối.

Folder: `contexts/system/`.

## 2. Ngoài phạm vi

- Cơ cấu phòng ban nhiều cấp, HR
- Phân quyền động phức tạp / warehouse scope (P06)
- Trading customer/supplier (`contexts/master-data`) — khác `system.Partner`
- Federation inbox/ACK apply (P09)
- Tự động khám phá đối tác trên mạng

## 3. Phụ thuộc / cung cấp

| Hướng | Nội dung |
| --- | --- |
| Phụ thuộc | Platform (identity, audit, pipeline, SSRF), schema P02 |
| Cung cấp cho M02–M04 | Org profile, user/role, federated Partner, Connection |
| Cung cấp cho M04/P09 | Dữ liệu xác thực federation (NX-FED-02) |

## 4. Aggregate / sự kiện chính

- `Organization`, `Membership` (user + role)
- `Partner`, `PartnerConnection` (federation)
- Audit: org/member/partner/connection changes; optional `partner.connection.updated` outbox khi cần

## 5. API bề mặt

- `GET/PATCH /api/v1/organization`
- `GET/POST /api/v1/members`, `PATCH /api/v1/members/{id}` (map Keycloak `sub`; không lưu password)
- `GET/POST/PATCH /api/v1/partners`
- `GET/PUT /api/v1/partners/{id}/connection` (inbound/outbound tách chiều; secret write-only ref)

## 6. UI bề mặt

- Hồ sơ doanh nghiệp
- Danh sách member / gán `administrator|staff|approver|viewer`
- Danh sách federated partner + form kết nối (URL, client id, secret **reference**)

## 7. Kiểm thử tối thiểu

- Unit: không lưu/log secret connection plaintext
- API: chỉ Administrator quản lý connection/members write
- Deploy: mỗi instance một org (AC-02); MFA Admin/Approver trước demo G05

## 8. Tiêu chí Done

- [x] AC-02 technical package + `evidence/G05.md` (live MFA A/B/C follow-up)
- [x] Partner + Connection đủ để P09 gọi instance đối tác
- [x] Plan phase-05 đã căn chỉnh no-migration / admin-invite / T06≠P09

## 9. Ghi chú DevOps

- Schema `system.*` đã có từ P02 — không recreate.
- Secret connection chỉ reference (env/secret store).
- Sync user: Admin invite → Keycloak user + membership row; role từ DB không từ token claims tùy ý.
- Validate URL đối tác bằng SSRF allowlist.

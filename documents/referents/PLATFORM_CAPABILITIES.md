# Platform capabilities (MVP)

Các năng lực dùng chung. Không phải module ERP riêng ngoài M01–M04/AI01; Reporting chỉ là **read-model/ops stats**.

## CRUD

- Pattern theo aggregate: Create / Get / List / Update (Draft) / action (`confirm`/`cancel`).
- Không có generic CRUD trên mọi bảng.
- Bản ghi `confirmed` bất biến; sửa sai bằng chứng từ bù + audit.

## RBAC

| Role | Quyền chính |
| --- | --- |
| `administrator` | Org, members, partner connection, federation retry, audit/report rộng |
| `staff` | Thao tác kho/chứng từ theo `membership_warehouse` |
| `approver` | Flowable approve/reject; không tự động có quyền confirm |
| `viewer` | Chỉ đọc theo scope |

Kiểm quyền trong application layer sau khi gateway chấp nhận token. Chi tiết: `CODING_RULES.md`, `phase-plan/security.md`.

## Workflow và state machine

- **Domain state machine:** Draft → … → Confirmed/Cancelled (và nhánh approval cho GoodsIssue).
- **Flowable:** process `goods-issue-approval` — điều kiện trước confirm; AC-12.
- Enum/transition trong TypeScript **không** thay engine Workflow.

## Queues

- SoT hàng đợi: bảng `platform.outbox_message` (ghi cùng TX nghiệp vụ).
- Worker claim/lease (Redis chỉ coordination); retry/backoff; federation chỉ mark delivered sau ACK hợp lệ.
- Redis mất không được mất message đã commit.

## Audit Log

- `platform.audit_log` append-only (INSERT/SELECT; không UPDATE/DELETE runtime).
- Ghi actor/client, action, target, outcome, request_id, summary đã redacted.
- API: `GET /api/v1/audit-logs` (administrator; filter allowlist).

## Reporting (read-model)

Chỉ `GET` có authz + pagination. Không BI builder / export phức tạp.

Endpoint tối thiểu:

| Route | Mục đích |
| --- | --- |
| `GET /api/v1/reports/inventory-summary` | Tổng hợp tồn theo warehouse/product/batch (scope) |
| `GET /api/v1/reports/document-counts` | Số chứng từ theo type/status/khoảng thời gian |
| `GET /api/v1/reports/open-quality-signals` | Cảnh báo/rule mở liên quan lô (khi có) |
| `GET /api/v1/audit-logs` | Tra cứu audit (Admin) |

DX-Lab vùng D tiêu thụ các API này qua gateway; không SQL trực tiếp.

## Liên kết

- Layering: `MVC_DDD_LAYERING.md`
- Schema: `../phase-plan/database-schema-v1.md`
- API: `../phase-plan/api-contracts.md`
- Prisma: `../phase-plan/prisma-migration-spec.md`

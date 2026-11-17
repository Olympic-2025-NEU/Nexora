# Quy tắc coding Nexora

Layering MVC↔DDD: `MVC_DDD_LAYERING.md`. Platform capabilities (CRUD/RBAC/Workflow/Queue/Audit/Reporting): `PLATFORM_CAPABILITIES.md`. Persistence: Prisma (`../phase-plan/prisma-migration-spec.md`).

## Giấy phép và ranh giới lõi

- Tệp mã do nhóm viết phải có thông báo `SPDX-License-Identifier: AGPL-3.0-only`; giữ toàn văn giấy phép trong `LICENSE`. Kiểm tra quyền và giấy phép của mã/tài sản bên thứ ba trước khi đưa vào repo.
- API Gateway, Identity/SSO, dữ liệu cấu trúc/phi cấu trúc và Workflow là năng lực của lõi headless. Route Handler Next.js và interface trong `platform/` không tự chứng minh các dịch vụ này đã hoạt động.
- Mọi API công bố cho ứng dụng và federation phải có đường đi và chính sách truy cập qua gateway được chốt trong plan triển khai.

## Pipeline lệnh ghi

Thứ tự bắt buộc trong route/application handler:

1. Xác thực (Actor từ phiên Keycloak/OIDC).
2. Phân quyền theo vai và phạm vi dữ liệu.
3. Idempotency (`Idempotency-Key`) trước khi làm lại lệnh đã thành công.
4. Domain kiểm bất biến và hành động trạng thái.
5. Một `prisma.$transaction`: ghi aggregate + lịch sử cần thiết + outbox + audit (cùng `TransactionClient`).
6. Sau commit: dispatcher gửi outbox. Lỗi bên nhận không rollback nghiệp vụ đã commit.

## Trạng thái chứng từ

- Trạng thái chỉ đổi qua hành động có tên (ví dụ `confirm`, `cancel`), không qua cập nhật cột `status` tùy ý.
- MVP Trading: `Draft → Confirmed | Cancelled`; GoodsIssue v1 thêm `pending_approval → approved/rejected` trước Confirmed qua Flowable. Delivery state của transfer tách khỏi document status.
- AI chỉ được tạo hoặc sửa ở trạng thái Draft. Confirm do người dùng.

## Sở hữu dữ liệu

- Chỉ `inventory` được thay đổi số lượng tồn.
- `trading` gọi port Inventory chỉ khi confirm GoodsReceipt (+), GoodsIssue (−), ReceivingConfirmation (+actual), Stocktake (±variance). PartnerTransfer/SaleRecord chỉ link issue đã trừ tồn, không gọi Inventory lần hai.
- `traceability` không sửa tồn kho hay chứng từ trading; chỉ ghi sự kiện và quan hệ.
- `federation` phân biệt xác nhận kỹ thuật (nhận message) và xác nhận nghiệp vụ (Receiving Confirmation).

## Outbox và sự kiện

- Mọi sự kiện cần gửi ra ngoài hoặc sang Traceability sau confirm phải vào outbox trong cùng giao dịch.
- Gửi lại được; chống trùng bằng khóa nghiệp vụ (message id / idempotency key).
- Nhận thông tin xuất hàng từ đối tác không đồng nghĩa đã nhập đủ số lượng.

## Quyền MVP (RBAC)

Vai membership (một nguồn với `database-schema-v1.md`):

| Role | Phạm vi chính |
| --- | --- |
| `administrator` | Org, members, partner connection, retry federation, audit/report rộng, policy |
| `staff` | Draft/confirm trong kho được cấp, xem lot/trace theo scope |
| `approver` | Quyết định Flowable task (không đồng nghĩa tự confirm document; separation-of-duties) |
| `viewer` | Chỉ đọc theo warehouse/row scope được cấp |

Warehouse scope qua `membership_warehouse`. Phân quyền resource chạy trong application dù gateway đã chấp nhận token.

Phạm vi dòng khi cần: `all`, `read`, `own`, `unit`, `assigned` (học từ DX-OS; áp dụng dần).

## Kiểm thử tối thiểu theo thay đổi

- Unit: bất biến domain của aggregate đang sửa.
- Integration: confirm chứng từ cập nhật tồn + tạo outbox.
- API: authz và validation đầu vào.
- Federation: khi đụng M04 — retry, dedupe, ack.
- AI: khi đụng AI01 — tool không vượt quyền; chỉ draft.

## Cấm trong MVP

- Thêm module finance, CRM, POS đầy đủ, sản xuất, QC nhiều bước.
- SaaS multi-tenant trên một database.
- Import Laravel/Eloquent hoặc ORM thứ hai; persistence = **Prisma** + Next.js + TypeScript.
- Gọi `prisma.*` từ route handler hoặc domain; chỉ repository/infrastructure được dùng Prisma client.
- AI tự confirm hoặc tự kết luận hàng giả không có căn cứ.

# Audit v1 — lưu giữ, tra cứu và xuất dữ liệu

**Áp dụng từ P03-T03.** `platform.audit_log` là lịch sử hành động thành công, ghi cùng transaction với tài nguyên. Lệnh bị từ chối hoặc transaction thất bại ghi vào security log riêng bằng reason code; chúng không tạo row `success` giả trong transaction đã rollback.

## Nội dung và quyền

- Audit row chứa actor `sub` **hoặc** `client_id` đã xác thực, action, target type/id, outcome, request/correlation ID, thời điểm PostgreSQL và snapshot theo allowlist (`status`, `version`, `kind`, `visibility`, `scanState`, `tool`, `count`, tên field đã đổi). Adapter bỏ mọi field khác; không ghi token, password, email, tên người, raw payload hoặc stack trace.
- `app_runtime` và `core_data` có `SELECT, INSERT` trên audit, không có `UPDATE/DELETE/TRUNCATE`; chỉ role `migrator` sở hữu schema. Không dùng quyền migrator cho ERP/Core API. Action thành công phải gọi `prismaAuditRecorder.record(tx, entry)` với **cùng** `TransactionClient`; lỗi ghi audit làm rollback command.
- `GET /api/v1/audit-logs` yêu cầu gateway xác thực Bearer OIDC; application kiểm membership DB và chỉ cho Administrator theo policy. API không trả `before_summary`/`after_summary`; filter cho phép `action,targetType,targetId,requestId,outcome,from,to`, limit tối đa 100 và cursor opaque. Ví dụ điều tra chứng từ: `?targetType=document&targetId=<id>`; message: `?targetType=message&targetId=<issuer-qualified-id>`; theo một request: `?requestId=<request-id>`.

## Retention v1 và export

- Mục tiêu vận hành ban đầu: **365 ngày online**, rà lại theo nghĩa vụ pháp lý/chính sách của từng doanh nghiệp trước production. P03 không tự xóa row audit. Bất kỳ thay đổi thời hạn nào cần quyết định owner, migration/job bảo trì riêng và test restore; runtime role không được xóa.
- Backup audit nằm trong backup app DB ở P03-T06. Bản export điều tra dùng `pg_dump`/`pg_restore` với credential **migrator** ở môi trường vận hành cách ly, mã hóa ở nơi lưu, phân quyền chỉ người được giao, không commit bản dump. Xuất phạm vi audit: `pg_dump --data-only --table=platform.audit_log --format=custom --file=<secure-path> <database>`; manifest phải có SHA-256, mốc thời gian, instance ID và reference tới secret key, không có secret thô.
- Trước mọi purge trong phase vận hành sau: kiểm export/backup đã hoàn tất, restore thử sang DB khác, đối chiếu row count và checksum, rồi mới chạy job bảo trì có audit vận hành. Không UPDATE row cũ để “redact” sau khi ghi; phải ngăn PII ở application và xử lý yêu cầu dữ liệu bằng quy trình quản trị riêng.
- Security log deny/failure dùng structured reason code và ID request đã kiểm tra; không chứa token/PII. Gửi sang hệ thống log nội bộ theo retention bảo mật của instance, không coi log này thay `platform.audit_log` cho command thành công.
- AI (P10-T06): `AI_PROMPT_RETENTION=none` là mặc định/opt-out; `redacted` chỉ giữ metadata structured đã sanitize (`quantity`, `unit`, `sourceIds`, `asOf`, `verification`, `count`). Raw prompt, câu trả lời model, token nội bộ và canary/PII không bao giờ được lưu. Đây là cờ env của operator, không có settings UI.

## Điểm tích hợp còn phải kiểm

Tại P04/P05/P07/P10, use case confirm/cancel, partner connection, worker và AI tool phải truyền actor/service identity, action, target và request ID vào adapter này; mỗi phase phải có test của chính action đó. P03 chỉ chứng minh adapter, DB quyền, transaction và truy vấn; không tuyên bố các use case tương lai đã có audit.

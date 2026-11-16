# D05 — Niềm tin giữa các instance

- Ngày: 2026-11-17. Trạng thái: **chọn mô hình receiver-issued service account**, gateway scope test pass; app partner mapping/A-B-C/revoke chưa test, reviewer G00 còn mở.
- Câu hỏi: receiver biết sender nào được phép gửi và ràng thông điệp với partner nào khi ba DB độc lập?
- Quyết định: receiver cấp **confidential client/service account** trong realm receiver cho từng partner; sender lấy token client-credentials ngắn hạn từ receiver và gọi `/api/v1/federation/events` qua gateway. Gateway kiểm chữ ký/issuer/audience/scope `federation:write`; app receiver map `client_id` đã xác minh tới `system.partner_connection.inbound_client_id` và partner đang active trước khi ghi inbox. `issuerInstanceId` trong body phải khớp mapping, không là nguồn tin cậy. Không dùng user session để gửi M2M, không truy DB bên kia.

## Phương án, spike và gate

Chọn receiver-issued client vì receiver kiểm credential/rotate/revoke ở biên của mình. Shared API key ngoài OIDC không được chọn vì thiếu issuer/audience/rotation semantics thống nhất; client ID không phải secret nhưng vẫn cần token hợp lệ. Trong [spike](../phase-plan/evidence/spikes/infra/README.md), `sender-a` có `federation:write` tới route M2M 202, `sender-c` thiếu scope 403, user token tới M2M 403; cả hai service token bị private user route chặn 403. Đây chỉ là **gateway mock upstream** trong một realm, chưa có ba Keycloak/DB, partner mapping, suspend/rotate/replay hoặc inbox.

P02/P05/P09 phải test A/B/C với realm/client/secret tách, token sai issuer/audience/expired, partner disabled, mapping client→partner, body issuer mismatch, endpoint SSRF/TLS, rotate/revoke và mất ACK. Realm issuer URL phải thống nhất qua gateway/host (D04). Idempotency nằm ở inbox `(issuer,messageId,hash)` và event key (D08), không giả định OIDC ngăn replay payload.

# Runbook P09 — vận hành federation A/B/C

## Ranh giới và chuẩn bị

Mỗi instance có PostgreSQL, Keycloak, worker, gateway và audit riêng. Dùng tài khoản `administrator` đã bật MFA trên **đúng instance**; không dùng service account M2M cho API quản trị. Mở `/admin/federation` tại cổng ERP của A (`19080`), B (`19081`), C (`19082`). Màn hình gọi `GET /api/v1/admin/federation/operations`; bearer user phải thuộc membership Administrator active. API trả `no-store`, chỉ ID, trạng thái, mã lỗi allowlist và tuổi hàng đợi; không trả envelope, secret, endpoint hay nội dung lỗi gốc. `/api/v1/metrics` trả tổng hợp để Prometheus scrape qua đường nội bộ.

Không in `docker compose config` không có `-q`, nội dung `.env`, bearer token, payload hoặc log HTTP có Authorization. Ghi incident bằng instance, issuer, message ID, event type, correlation ID (nếu là UUID), thời điểm, trạng thái và mã lỗi đã lọc. Nếu cần chia sẻ chứng cứ, che các trường thông tin cá nhân trong ảnh và không xuất toàn bộ DB.

## Tìm một transfer thất bại

1. Lấy `messageId` từ trạng thái transfer sender hoặc danh sách dead letter trên A/B/C. Tra ID đó ở `/admin/federation` sender; một outbox có thể có ID DB khác `payload.messageId`, API nhận cả hai. Ghi `status`, `attemptCount`, từng attempt (`result`, HTTP, mã lỗi), `correlationId` và `deliveredAt`.
2. Tra **cùng envelope message ID** trên receiver. Inbox `validated`/`pending_dependency` nghĩa là technical ACK đã nhận, chưa chắc có business receipt; `applied_to_trace` nghĩa là mapping/trace đã xử lý. `rejected` cần điều tra mã lỗi/nguồn trước khi gửi lại. Nếu sender `delivered` mà receiver thiếu, xác minh ID thực trong ACK và đúng instance; không tự tạo lại payload với cùng ID.
3. Kiểm `Phiếu nhận chờ / chênh lệch` ở sender. `pending`/`technical_ack` chờ Staff receiver xác nhận **actual**; `partial` là đã xác nhận thiếu/zero; `disputed` cần đối chiếu chứng từ, không sửa quantity sender bằng DB. Receiver xem receiving liên kết `sourceLineId`, lô local và chứng từ nguồn. `receipt.confirmed.v1` phải tới sender trước khi kết luận business receipt hoàn tất.
4. Theo A→B→C, tra từng message ID kế tiếp và issuer-qualified `upstreamRefs`/trace graph. Không coi correlation ID là khóa duy nhất toàn mạng. `remote_source_unavailable`, `downstream_unreported` hoặc stale là gap thực sự; không xóa gap bằng cách tự gộp lô theo SKU.

## Retry, reprocess và xử lý chênh lệch

- **Outbox dead letter:** sửa nguyên nhân trước (connection, mạng, schema/version, quyền partner). Administrator nhấn `Retry` hoặc `POST /api/v1/admin/retries` với đúng `{ "messageId": "<outbox-uuid>" }`. API chỉ nhận trạng thái `dead_letter`, đặt lại `pending`, ghi `outbox.dead_letter.retried` trong audit; gọi lại khi đã pending trả 409. Worker gửi lại **cùng** envelope/hash, sequence attempt tăng tiếp. Lỗi 409/413/422 vĩnh viễn không được retry mù quáng.
- **Inbox pending dependency:** hoàn tất parent hoặc binding lô local qua receiving hợp lệ, rồi nhấn `Reprocess` hoặc `POST /api/v1/admin/federation/operations` với `{ "action": "reprocess", "inboxId": "<inbox-uuid>" }`. Chỉ pending mới được xử lý; thao tác khóa row, chạy resolver idempotent, ghi `federation.inbox.reprocessed` với trạng thái trước/sau trong audit. Nếu vẫn pending, tra mapping gap và chờ parent. Nếu `rejected`, không sửa inbox/payload bằng tay; đối tác phải tạo correction/version hợp lệ.
- **Partial/dispute:** Staff receiver xác nhận số thực nhận theo từng sent line và lý do chênh; sender theo dõi `businessReceipt` và liên hệ đối tác để xử lý nghiệp vụ. Giữ immutable issue/transfer gốc; correction là chứng từ/sự kiện mới qua quy trình, không sửa movement, inbox hay ACK. Chỉ đóng incident khi số dư, chứng từ và event nối lại đúng.

## Rotate hoặc revoke credential M2M

1. Xác định hướng gửi (A→B, B→A, B→C, C→B). Tạo secret mới trong kho bí mật của sender và client credential tương ứng ở Keycloak **receiver**; không ghi giá trị vào PostgreSQL/Git. Giữ credential cũ hoạt động cho đến khi đường mới được kiểm chứng để tránh mất message đang retry.
2. Trên sender, Administrator `PUT /api/v1/partners/{id}/connection` với **đủ bảy trường** `endpointUrl`, `outboundTokenUrl`, `outboundClientId`, `outboundSecretRef` (chỉ reference), `outboundAudience`, `inboundClientId`, `allowedInboundScope`; giữ `status=active` khi muốn worker tiếp tục gửi. `rotating` tạm chặn gửi và chỉ dùng trong cửa sổ bảo trì. Route kiểm URL/secret reference, audit `partner.connection.rotate`, không trả secret. `inboundClientId` là client của đối tác được đăng ký ở Keycloak local; `outboundClientId` là client của sender tại receiver. Kiểm scope `federation:write` ở cả hai hướng.
3. Chạy connectivity probe M2M qua gateway receiver, gửi một message fixture demo hoặc chờ message thật và xác nhận ACK/outbox/inbox bằng message ID. Khi đường mới hoạt động, revoke credential cũ ở Keycloak/secret store. Nếu bị `OUTBOUND_CREDENTIAL_REVOKED`, giữ dead letter, khắc phục credential rồi retry có audit. Không chạy lại `prepare-abc-federation` trên production như một cách rotate.

## Alert và fault drill

- Metrics: `federation_queue_oldest_age_seconds`, `federation_queue_due`, `federation_delivery_attempts{result}`, `federation_inbox{state}`, `federation_business_receipt{state}` và `outbox_dead{destination="federation"}`. Cảnh báo khi queue quá 900 giây, inbox pending quá 900 giây/rejected, business receipt pending quá 3600 giây/disputed, hoặc dead letter >0. Tín hiệu `CLOCK_SKEW_WARNING` cần đối chiếu đồng hồ, không được tự reject sự kiện lịch sử chỉ vì chậm.
- Bộ kiểm thử `npm run test:platform:federation`, `npm run test:federation:outbound`, `npm run test:platform:ops`, `npm run test:gateway` phủ duplicate burst, replay conflict, size 413, schema 422, clock skew warning, timeout, 429/retry, B offline/recover (mô phỏng), quyền quản trị và redaction.
- Drill live chỉ trên môi trường demo: đặt `DEMO_ONLY=true`, chạy `node deploy/scripts/fault-p09-b-offline.mjs`; script dùng đủ ba overlay, kiểm A/C vẫn phục vụ khi B tắt, tự khởi động lại B trong `finally` và không dùng `down -v`. Với message thật đang due, theo dõi sender `retry_due` rồi cùng message ID chuyển `delivered` sau recovery; test outbound mô phỏng giữ hash/ACK khi B không đáp. Đối chiếu balance trước/sau bằng `node deploy/scripts/journey-p09-trace.mjs verify`. Nếu không có message due, fixture `smoke-abc-federation.mjs` chỉ chứng minh transport và không tạo stock.

## Dừng/leo thang

Nếu `MESSAGE_ID_REUSED`/`EVENT_ID_REUSED`, dừng retry và so hash/issuer với đối tác; đây là xung đột hợp đồng. Với `UNSUPPORTED_SCHEMA`/`PARTNER_REJECTED_422`, cần đồng bộ version rồi tạo correction hợp lệ. Nếu pending kéo dài do thiếu parent hoặc policy revoke, giữ gap/stale hiển thị và yêu cầu đối tác công bố đúng scope. Không xóa row, reset volume hoặc cấp quyền rộng để xóa cảnh báo.

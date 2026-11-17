# D08 — Envelope và ACK federation v1

- Ngày: 2026-11-16. Trạng thái: **chấp nhận contract thiết kế**; JSON Schema/consumer test chạy ở P00-T05/P09, reviewer thứ hai ở G00.
- Quyết định: envelope v1 theo `event-payloads-v1.md`; event ID nghiệp vụ và message ID truyền tải là hai khóa khác nhau. `issuerInstanceId` lấy từ M2M token→partner mapping ở receiver, `recipientInstanceId` phải bằng local instance. Origin lot và sender batch tách riêng, mỗi lot có `sourceLineId`; `upstreamReferences` giữ chain. ACK HTTP 202 chỉ xác nhận inbox đã ghi; ReceivingConfirmation do người dùng xác nhận mới đổi tồn.
- Câu hỏi: làm sao A→B→C giữ nguồn gốc, retry không tạo hai effect và không suy ACK là đã nhận hàng?

## Quy ước chốt

`schemaVersion='1.0'`; event type có `.v1`; UUID ID, UTC timestamp, quantity decimal string, `additionalProperties:false`, message <=256 KiB và <=100 lines. Payload SHA-256 trên UTF-8 [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785.html); reject duplicate keys trước parse. Sender giữ message ID/payload cho mọi retry; receiver unique `(issuer,message_id)` và `(issuer,event_id,event_type)`, same ID/hash trả ACK đã lưu, ID cũ/hash khác hoặc event cũ/message mới trả 409. `pending_dependency` vẫn ACK kỹ thuật rồi đợi parent, hiển thị gap. Chỉ public projection allowlist; không forward raw upstream payload nếu policy không cho phép.

M2M bearer + TLS là authn/authz vận chuyển v1; payload hash phục vụ dedupe/kiểm toàn vẹn khi lưu, **không phải chữ ký số của đối tác**. Nếu BTC hoặc threat model bắt non-repudiation, thêm chữ ký có ADR/schema version mới. `receipt.confirmed.v1` có `actualLines` cho *mọi* source line, cả actual 0; `lots` chỉ actual dương. `downstream.impact.v1` chỉ relay summary được phép để A có thể biết C, nếu thiếu thì trả gap/unknown.

## Evidence và acceptance chưa giả xanh

Ví dụ JSON UUID hợp lệ và quantity=sent ở [event-contracts.md](../phase-plan/event-contracts.md); RFC/JCS là chuẩn được chọn, **chưa có** JSON Schema hay cross-language hash test trong codebase ở P00-T03. P00-T05 phải tạo fixtures Node/Python cùng hash, valid/invalid/schema-version tests; P09 phải chạy A→B→C, replay same/different hash, lost ACK, offline/order, actual 10/12 và privacy. D01/D05 phải chứng minh token→issuer mapping trước inbox. Không xem đề xuất envelope là federation đã chạy.

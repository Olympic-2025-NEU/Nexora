# Mô hình bảo mật và quyền tối thiểu

## 1. Ranh giới tin cậy

Internet chỉ đến Gateway HTTPS. User token từ Keycloak, partner token từ service account của **receiver**; Next ERP app và core data/file API xác thực lại token/session và quyết định quyền tài nguyên của mình. DX-Lab frontend tầng 2 chỉ tiêu thụ API qua gateway. Mạng nội bộ tách PG, Redis, Flowable REST, storage admin, etcd nếu có, Python AI. Không tin `tenantId`, role, partner ID hoặc header danh tính từ body/browser. Một instance một org; chi nhánh/kho là scope nội bộ.

## 2. Danh tính và quyền

**Auth model (D04 P02-T01):** Bearer API auth — browser lấy token qua authorization-code + PKCE; mọi API call dùng `Authorization: Bearer <token>`. Không có BFF/cookie session trên API layer ở P02. `organizationId` lấy từ DB membership row, không bao giờ từ token body hoặc payload.

**MFA bắt buộc cho Administrator và Approver:** Keycloak gán required action `CONFIGURE_TOTP` khi tạo user có role administrator/approver. Staff và viewer không yêu cầu MFA mặc định.

| Chủ thể | Xác thực | MFA | Quyền mẫu |
| --- | --- | --- | --- |
| Administrator | OIDC user (Bearer) | **Bắt buộc TOTP** | Org, members, partner connection, retry, policy; không tự duyệt nếu separation-of-duties cấm |
| Staff | OIDC user (Bearer) | Không bắt buộc | Tạo Draft, confirm trong kho được cấp, xem lot/trace và file theo scope |
| Approver | OIDC user (Bearer) | **Bắt buộc TOTP** | Approve/reject task; không đồng nghĩa tự confirm document |
| Partner client | Client credentials cấp ở receiver | N/A | Chỉ federation endpoints/phạm vi partner, không xem ERP private |
| Public consumer | Không đăng nhập | N/A | Chỉ Passport projection theo QR/policy/rate limit |
| AI service | Internal secret, không có user/Admin/DB credential | N/A | Chỉ inference từ fact allowlist; ERP kiểm quyền từng tool theo actor, không chuyển raw token/PII cho model |

M01 quản lý mapping `Keycloak sub -> membership/role/scope` qua **admin invite** (không open JIT). Invite nhận `username` (không nhận `keycloakSub` từ client): ERP dùng Keycloak Admin API tạo/tái sử dụng user, gán realm role, ghi membership; mật khẩu tạm chỉ trả một lần trên response tạo mới, không lưu app DB. Vai membership v1: `administrator`, `staff`, `approver`, `viewer` (DB authoritative; không dùng alias `admin`). Approver gắn Flowable task; không đồng nghĩa quyền confirm document.

Permission keys M01 trong `platform/access/policy.ts`: `admin:organization:read|manage`, `admin:membership:read|manage`, `admin:partner:read|manage`, `admin:partner:connection:manage`, `federation:connectivity:probe` (M2M; inbox = P09). Permission keys M02: `catalog:product:read|create|manage`, `catalog:batch:read|create|quality`, `inventory:warehouse:read|manage`, `inventory:stock:read`. Warehouse scope: Administrator = toàn instance; Staff/Approver/Viewer = `system.membership_warehouse` (revoke hiệu lực request sau). Gán scope qua `admin:membership:manage` + `warehouseIds` trên member invite/PATCH. Resource authz document đầy đủ ở P07+. Mọi 403 phải có audit an toàn; tránh phân biệt tài nguyên không tồn tại với không được phép nếu gây lộ ID.

## 2.1. XSS, CSRF, SQL Injection (bắt buộc)

| Threat | Biện pháp |
| --- | --- |
| **SQL Injection** | Chỉ Prisma Client API; `$queryRaw`/`$executeRaw` dùng tagged template hoặc bind values — **cấm** nối chuỗi SQL từ input. Sort/filter/report: allowlist cột trong code. |
| **XSS** | React escape mặc định; cấm `dangerouslySetInnerHTML` trừ allowlist + sanitize. CSP qua Next/gateway. Passport/public chỉ field projection; không render HTML từ partner payload thô. Encode output API khi đưa vào UI. |
| **CSRF** | **Bearer primary (P02): CSRF N/A cho Bearer-only API — không có session cookie trên API layer.** Nếu BFF/cookie layer được thêm trong tương lai: `SameSite=Lax` hoặc `Strict`, `Secure`, CSRF token hoặc double-submit cookie cho mutative browser calls. API bearer M2M/federation: không dùng cookie session → không áp CSRF cookie. Origin/Referer check bổ sung khi dùng cookie. |
| **Mass assignment** | Zod schema cố định; bỏ field `role`, `orgId`, `createdBy`, `status` từ body nếu client tự gửi. |

Threat-test tối thiểu: XSS reflection trên field text chứng từ/Passport; CSRF thiếu token → 403; filter report với payload SQL → 400 và không đổi dữ liệu.

## 3. Route và dữ liệu

- Gateway đặt default deny, route allowlist; OIDC bearer cho private/federation, auth-code+PKCE cho browser theo ADR; public route giới hạn method/size/rate. Header do gateway thêm phải được xóa từ request bên ngoài trước khi set lại.
- Keycloak admin, Flowable REST, storage console, metrics nội bộ và gateway admin API không public. Secret trong env/secret store dev, không commit; rotate test cho partner credential.
- File upload: MIME/extension/size allowlist, key ngẫu nhiên, bucket quarantine, ClamAV scan theo phiên bản signature; chỉ chuyển trạng thái `clean` mới cho tải/chia sẻ. Scan lỗi = fail closed, không tạo public URL. Chứng từ private không đi qua QR policy mặc định.
- QR token opaque 256 bit, không mã hóa raw DB ID; DB chỉ lưu hash, raw URL trả một lần, hết hạn sau 30 ngày. Revoke/rotate được; policy/version hoặc quality đổi làm token cũ vô hiệu. Endpoint API và trang `/passport/*` đều đi qua gateway rate limit 30 req/s burst 15; 404 đồng nhất khi token sai/hết hạn/revoked. Projection allowlist, không PII, giá, credential, ghi chú nội bộ. Public API và HTML dùng `no-store`, `no-referrer`, không index để chính sách/batch status đổi có hiệu lực ngay.
- Evidence public (P08-T07) chỉ tạo từ attachment scan `clean` trong bucket private, checksum snapshot trùng bytes metadata, event local confirmed, policy timeline/evidence public đã duyệt và Administrator. URL capability 256 bit chỉ sống 60 giây; Core Data kiểm lại QR/policy/quality/projection/link/file qua view hạn chế quyền và đối chiếu checksum bytes trước khi stream. Không trả raw S3 URL hoặc credential. Private/infected/pending/revoked file không có link Passport; thay scan/checksum hay revoke làm projection stale, URL cũ 404. Access grant hết hạn được worker dọn; response `no-store`, `no-referrer`, `nosniff`, CSP sandbox.
- AI: tool input schema, output limit, log redacted, không SQL tùy ý; kết quả dữ liệu có ID nguồn và quyền của user; prompt injection từ document/partner event không được biến thành lệnh hệ thống.

## 4. Các tình huống đe dọa phải test

| Tấn công/lỗi | Kết quả mong muốn |
| --- | --- |
| Token hết hạn/sai issuer/audience/scope | 401/403 ở gateway hoặc app, không tạo side effect |
| Staff đổi `orgId`, kho, `createdBy` trong body/header | Bị bỏ qua hoặc reject; actor lấy từ session và scope server |
| Gọi thẳng Next bypass gateway | Port không public hoặc app vẫn xác thực/authorize; không có đường bypass hợp lệ |
| SSRF qua partner endpoint | URL allowlist/HTTPS, không truy cập internal IP/metadata; chỉ Admin đổi |
| Replay message/Idempotency-Key khác payload | Một effect hoặc 409; audit đầy đủ |
| Upload tệp độc hại, scan timeout | Quarantine, không download/public |
| QR đoán được, truy cập private attachment | Không thể truy cập; rate limit và policy |
| Prompt injection yêu cầu confirm hoặc đọc lot ngoài quyền | Tool reject; không có confirmed document/stock movement |
| XSS payload trong text field / Passport | Không thực thi script; CSP chặn inline nếu cấu hình |
| CSRF: POST confirm cookie session thiếu token | 403; không side effect |
| SQLi trong `sort`/`filter` report hoặc list | 400; query không chạy chuỗi tùy ý; audit/deny |

## 5. Chứng cứ bảo mật cần bàn giao

Gateway route map, realm/client export đã bỏ secret, bảng role-scope, threat-test log, inventory secret/rotation, scan demo, privacy snapshot của Passport, kết quả dependency/license scan, hướng dẫn revoke QR và partner credential. Không công bố token hoặc tệp thật trong test artefact.

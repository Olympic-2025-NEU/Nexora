# Mô hình bảo mật và quyền tối thiểu

## 1. Ranh giới tin cậy

Internet chỉ đến Gateway HTTPS. User token từ Keycloak, partner token từ service account của **receiver**; Next ERP app và core data/file API xác thực lại token/session và quyết định quyền tài nguyên của mình. DX-Lab frontend tầng 2 chỉ tiêu thụ API qua gateway. Mạng nội bộ tách PG, Redis, Flowable REST, storage admin, etcd nếu có, Python AI. Không tin `tenantId`, role, partner ID hoặc header danh tính từ body/browser. Một instance một org; chi nhánh/kho là scope nội bộ.

## 2. Danh tính và quyền

**Auth model (D04 P02-T01):** Bearer API auth — browser lấy token qua authorization-code + PKCE; mọi API call dùng `Authorization: Bearer <token>`. Không có BFF/cookie session trên API layer ở P02. `organizationId` lấy từ DB membership row, không bao giờ từ token body hoặc payload.

**MFA bắt buộc cho `administrator` và `issue_approver`:** Keycloak gán `CONFIGURE_TOTP` khi membership chứa các role này (ADR 0018). Các job role khác không bắt buộc MFA mặc định.

| Chủ thể / job role | Xác thực | MFA | Quyền mẫu |
| --- | --- | --- | --- |
| `administrator` | OIDC Bearer | **TOTP** | Org, members, partners, warehouse master, ops retry; bypass hầu hết (trừ M2M partner) |
| `catalog_manager` | OIDC Bearer | Không | Catalog/UOM/category/price/batch create+quality |
| `inventory_clerk` | OIDC Bearer | Không | Receipt/issue/transfer/receiving; stock read; issue submit/confirm |
| `sales_clerk` | OIDC Bearer | Không | Sale record + POS |
| `stocktake_clerk` | OIDC Bearer | Không | Stocktake CRUD/confirm |
| `issue_approver` | OIDC Bearer | **TOTP** | `workflow:approval:read\|decide` (SoD: không tự duyệt; **không** confirm document) |
| `quality_officer` | OIDC Bearer | Không | `ops:quality:*` |
| `auditor` | OIDC Bearer | Không | Read-only rộng (catalog/inventory/trading/trace/org) |
| Partner client | Client credentials | N/A | Chỉ federation endpoints |
| Public consumer | Không đăng nhập | N/A | Passport projection |
| AI service | Internal secret | N/A | Tool theo quyền actor |

M01: mapping `Keycloak sub → membership + membership_role + warehouse scope` qua **admin invite** (không open JIT). Invite/PATCH nhận `roles: string[]` (min 1; fixed codes). DB authoritative; Keycloak realm roles mirror tập job roles. `issue_approver` gắn Flowable / workflow decisions; không đồng nghĩa quyền confirm chứng từ.

Permission keys: `platform/access/policy.ts` (ADR 0018). Warehouse scope: `administrator` = toàn instance; các role khác = `system.membership_warehouse`. Mọi 403 có audit an toàn.

### Ma trận job-role × chứng từ (state machine)

| Document | create/edit | submit | approve/reject | confirm/cancel |
|----------|-------------|--------|----------------|----------------|
| receipt | `inventory_clerk` | — | — | `inventory_clerk` |
| issue | `inventory_clerk` | `inventory_clerk` | `issue_approver` (`workflow:approval:*`) | `inventory_clerk` (sau approved) |
| transfer / receiving | `inventory_clerk` | — | — | `inventory_clerk` |
| stocktake | `stocktake_clerk` | — | — | `stocktake_clerk` |
| sale | `sales_clerk` | — | — | `sales_clerk` |

Catalog manage → `catalog_manager` (+ admin); warehouse manage → `administrator` only. Legacy keys `trading:goods-issue:*` removed — use `trading:issue:*` + `workflow:approval:*`.

Migrate: `staff` → clerks bundle; `approver` → `issue_approver`+`auditor`; `viewer` → `auditor`.

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

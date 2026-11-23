# API contract đề xuất để chốt ở P00

Đây là **bề mặt API mục tiêu**, chưa tồn tại. Route và DTO/response/error chi tiết v1 ở [api-payloads-v1.md](./api-payloads-v1.md); file OpenAPI thực phải sinh ở P00/P02. Giữ `/api/v1`, JSON UTF-8, thời gian ISO 8601 UTC, ID opaque; không trả nguyên stack trace. Contract ở đây phải được sửa cùng test và client khi ADR thay đổi. Next Route Handler là **Thin Controller** (MVC map): chỉ validate + gọi use case — xem `../referents/MVC_DDD_LAYERING.md`.

## 1. Quy tắc chung

- Private user API: OIDC/session qua gateway + xác thực lại ở app, role/scope và row-level checks. Federation API: token service account riêng, partner binding. Public passport: route allowlist, rate limit và projection public.
- Lệnh ghi cần `Idempotency-Key` ở confirm/transfer/receiving và các POST có hậu quả không lặp; lưu key cùng payload hash trong DB. Tạo Draft có thể dùng key để chống double-click.
- `POST /.../{id}/confirm`, `cancel`, `submit` và `/approvals/{id}/decision` là action rõ; không nhận `PATCH status`. `If-Match`/version chống lost update; decision trả pending cho tới khi Flowable đối soát.
- Response lỗi có `code`, `message`, `requestId`, `details` an toàn. 400 malformed, 401 unauthenticated, 403 forbidden, 404 không thấy/không được tiết lộ, 409 conflict/idempotency/version/stock, 422 invalid domain, 429 throttled, 503 dependency unavailable.
- Paginate mọi list bằng opaque cursor, `limit` mặc định 20/tối đa 100 theo baseline; sort/filter allowlist. OpenAPI ghi scope, field public và ví dụ lỗi.
- Gateway route matrix là một phần contract: `/api/v1/public/*` anonymous allowlist; `/api/v1/federation/*` M2M; `/api/v1/*` user/private; health nội bộ chỉ lộ trạng thái tổng quát. Không public Flowable/admin/PG/Redis/storage.

## 2. Bề mặt theo module

| Owner | Route tối thiểu | Hành vi và điều kiện đáng kiểm thử |
| --- | --- | --- |
| Platform / Core Data | `GET /api/v1/me` (ERP), `GET /api/v1/health/live|ready` (từng service), `GET/POST /api/v1/core/records`, `POST /api/v1/files`, `GET /api/v1/files/{id}` (core API) | `/me` lấy từ token/session, không body; core records là resource allowlist/versioned có policy, không phải generic SQL; ready kiểm đúng dependency; file scan/policy trước download |
| M01 | `GET/PATCH /api/v1/organization`, `GET/POST /api/v1/members`, `GET/POST/PATCH /api/v1/partners`, `GET/PUT /api/v1/partners/{id}/connection` | Chỉ Admin đổi connection; secret write-only/redacted; URL allowlist, rotate credential |
| M02 Catalog | `GET/POST /api/v1/products`, `GET/PATCH /api/v1/products/{id}`, `GET/POST /api/v1/batches`, `GET/PATCH /api/v1/batches/{id}` | SKU/barcode/lot unique theo scope, ngày SX ≤ HSD, status lô có rule |
| M02 Inventory | `GET/POST /api/v1/warehouses`, `GET /api/v1/inventory/balances`, `GET /api/v1/inventory/movements` | Balance read-only qua public API; điều chỉnh từ M03 use case, không PATCH quantity |
| M03 | `GET/POST /api/v1/receipts|issues|transfers|receivings|stocktakes|sales-records` và `POST /{type}/{id}/confirm|cancel` | Draft không đổi tồn; confirm có quyền, version, approval nếu áp dụng, transaction + outbox; receiving có actual qty/discrepancy |
| M04 Trace | `GET /api/v1/trace/status`, `GET /api/v1/lots/{id}/history`, `/trace/backward`, `/trace/forward`, `POST /api/v1/lots/{id}/qr`, `GET /api/v1/public/passport/{token}` | Status riêng cho local outbox lag, không khẳng định partner history đầy đủ; graph giới hạn depth/page; ghi khoảng thiếu, issuer/evidence; public projection không lộ PII/giá/secret |
| M04 Federation | `POST /api/v1/federation/events`, `GET /api/v1/federation/deliveries`, `POST /api/v1/federation/deliveries/{id}/retry` | M2M auth, schema_version, dedupe/hash; technical ACK là response 202 có message ID (async ACK route chỉ thêm nếu ADR chứng minh cần), riêng business receipt; admin-only retry |
| AI01 | `POST /api/v1/ai/chat`, `POST /api/v1/ai/drafts`, `GET /api/v1/ai/tool-calls/{id}` nếu cần audit UI | Tool allowlist; cùng quyền user; chỉ Draft; timeout/fallback; response có source IDs |
| Platform Audit | `GET /api/v1/audit-logs` | Administrator; filter allowlist; append-only data |
| Platform Reports | `GET /api/v1/reports/inventory-summary`, `.../document-counts`, `.../open-quality-signals` | Read-model/ops stats theo RBAC scope; không BI builder |

Các route `/{type}` trên là ký hiệu rút gọn; OpenAPI phải liệt kê từng path cụ thể, không implement dynamic catch-all cho mọi loại chứng từ.

`GET /api/v1/lots/{id}/trace/backward` (P08-T03) nhận local batch UUID, tùy chọn `documentId` cùng lô, `depth` 1–10 (mặc định 3), `limit` 1–100 (mặc định 20), `cursor` snapshot. Mỗi node trả `eventId`, issuer, batch ID, origin issuer/lot, event type, `occurredAt`, `recordedAt`, verification, source document/event/version và số hop. Edge chỉ biểu thị link nguồn đã lưu; node cùng lô nhưng không có link chỉ là bối cảnh, không suy ra phân bổ lượng receipt→issue. `gaps` phân biệt remote source chưa có, local allocation chưa biết, projector còn chờ, giới hạn depth/nút. `localProjection` là tình trạng hàng đợi **toàn instance**, không chứng nhận upstream đã đầy đủ. Cursor đóng băng `recordedAt` và link creation cutoff, gắn với batch/document/depth; mỗi trang tối đa 100 node, truy vấn tối đa 2000 node rồi trả `truncated`/gap. API yêu cầu user role có `trace:read`, trả `private, no-store`; P09 mới bổ sung graph cross-instance có xác minh.

`GET /api/v1/lots/{id}/trace/forward` (P08-T04) đi từ sự kiện của local batch tới các sự kiện downstream qua `trace_link` đảo chiều truy vấn, nhưng giữ `sourceRelation` gốc. `impact` là từng dòng issue/transfer/receiving/sale đã confirm, số lượng decimal string và UOM từ dòng chứng từ nguồn; receiving tách sent/actual, transfer gắn issuer đối tác đích. Các dòng ở nhiều bước không được cộng thành một tổng “ảnh hưởng” vì issue→transfer/sale là cùng dòng hàng. Chỉ xem các dòng trong kho membership được cấp, Administrator toàn instance; không trả buyer ref/contact. Transfer chưa có downstream summary được ghi `unknown downstream`, dù có ACK kỹ thuật. Tham số depth/cursor/limit, mốc `asOf`, cap và projector status giống backward. P09 mới xác nhận tác động xuyên instance.

Passport policy (P08-T05) có năm nhóm visibility `organization/product/batch/timeline/evidence`, tất cả mặc định private. Chỉ Administrator của organization tạo draft, duyệt version hoặc revoke; endpoint riêng trả lịch sử policy và projection state. Projection lưu đúng bảy field của `PassportPublic`: `productName`, `publicLotCode`, `originIssuer`, `timeline`, `verificationState`, `gaps`, `asOf`; raw event, member/contact, buyer, giá, tồn và file private không được sao chép. Bản public chỉ active khi lô available, policy approved và ba nhóm bắt buộc đều public. Outbox hoặc trace event mới làm stale; quality change làm revoked. Rebuild có audit và không tự mở lại lô restricted. Giữ policy versions/audit để truy vết, không cache public payload; route T06 kiểm `active` mỗi lần GET và trả `no-store`.

### M03 document transition contract (P07-T01)

Source of truth for the pure domain matrix and guards: `contexts/trading/domain/document.ts`. Document status, approval request state, and stock effect are independent. `approved` means approved by the bridge, **not** stock posted; `confirmed` means the document was posted. Only `confirm` can cause a stock effect. `edit` keeps Draft status and requires current `If-Match` version; no `PATCH status` and no delete of confirmed documents.

| Document type | Allowed status/action/status | Effect upon confirm |
| --- | --- | --- |
| `goods_issue` | `draft/edit/draft`, `draft/submit/pending_approval`, `pending_approval/approve/approved`, `pending_approval/reject/rejected`, `approved/confirm/confirmed`, `draft\|pending_approval\|approved/cancel/cancelled` | `issue` (negative quantity) |
| `goods_receipt` | `draft/edit/draft`, `draft/confirm/confirmed`, `draft/cancel/cancelled` | `receipt` (positive internal receipt only) |
| `partner_transfer` | Same direct-confirm graph as goods receipt | none; linked confirmed issue already posted |
| `receiving_confirmation` | Same direct-confirm graph as goods receipt | `receiving` (positive actual; zero skips movement) |
| `stocktake` | Same direct-confirm graph as goods receipt | `stocktake` (counted − balance at confirm; zero skips movement) |
| `sale_record` | Same direct-confirm graph as goods receipt | none; linked confirmed issue already posted |

`pending_approval`, `approved`, and `rejected` are unreachable for all non-issue types. `rejected`, `confirmed`, and `cancelled` are terminal. Rejected issues require a **new** document; no edit/resubmit. An approval decision after cancel does not change the cancelled document. Cancel while pending also tombstones its bridge request in the same transaction (T07); late engine decisions cannot resurrect it. V1 has **no automatic expiry**: pending approval lasts until a decision or cancellation. Expiry policy belongs to T07, not this contract.

Every issue requires the `goods-issue-approval` bridge. Decision requires a current Approver, complete warehouse scope, and actor different from creator. Project `approve/reject` only from a proven local bridge decision. At issue confirm, call bridge `confirmApproval`/`assertConfirmable` within the caller transaction: require local `approved`, compare freshly computed current line hash to approved `line_snapshot_sha256` (canonical `{lineNo,warehouseId,productId,batchId,quantity,unit}`), recheck actor's **current** warehouse scope, and apply `If-Match` to **current** document version, not submitted version. Approval never posts stock; Flowable is never called from the domain. `halted`/engine ambiguity blocks confirmation.

`issue_purpose` is required and fixed at creation for goods issue only (`partner_transfer`, `sale`, `other`). Transfer/sale link a confirmed issue with matching purpose, at most once per target kind; purpose prevents cross-kind double allocation. Copy **every** source issue line exactly, including source line ID, lot, variant, warehouse, UOM and canonical quantity. Transfer additionally requires an active partner. Receiving requires one `source_line_ref` per authenticated transfer source line, no missing/extra/duplicate lines; each actual is between 0 and sent, with reason when different. Over-receipt is dispute/422, never stock added beyond sent. Partner inbound receiving is the sole positive event for those goods: do not create a second goods receipt for the same shipment. Goods receipts are internal only.

Correction is a **new document of the same type** with both `correction_of_document_id` (confirmed immediate predecessor) and nonblank `correction_reason`; no pair for a normal document. A correction may correct another confirmed correction. At most one non-cancelled correction per predecessor at once. It follows its own type's full lifecycle (including issue approval) and posts only its **own entered lines**; no automatic reversal or cascade to linked transfer/sale. Stocktake input contains counted quantity; read balance under lock at confirm and calculate `delta = counted − balance_at_confirm`. Confirm with delta zero still audits but writes no zero movement. Correction-chain ownership and constraints belong to T02/T03; cross-instance discrepancies to P09.

Header requirements: `document_type`, server-generated `document_number` (type prefix + date + 12 UUID characters, retry unique collision), `created_by_sub`, `correlation_id`; issue also `issue_purpose`, correction also paired `correction_of_document_id`/`correction_reason`. Each line requires `line_no`, `warehouse_id`, `batch_id`, `product_variant_id`, denormalized `product_id`, `uom_id`; receipt/issue/transfer/sale require `quantity`, transfer/sale also `source_issue_line_id`; receiving requires sent `quantity`, `actual_quantity`, `source_line_ref`; stocktake requires `counted_quantity`. Transfer detail requires `linked_issue_id`, `destination_partner_id`; receiving requires `source_issuer_instance_id`, `source_transfer_id` (plus sent/actual totals); sale requires `linked_issue_id`, `sold_at`; `buyer_ref` optional, no price/payment/PII. Input quantity is in selected UOM; server converts to variant stock UOM before Inventory port.

| Failure | Domain codes | Planned HTTP mapping |
| --- | --- | --- |
| Invalid state/action, terminal edit/delete/second confirm, bridge not approved or changed hash, already-linked issue/active correction | `WRONG_STATE`, `APPROVAL_NOT_CONFIRMED`, `APPROVAL_LINES_CHANGED`, `ISSUE_ALREADY_LINKED`, `CORRECTION_ALREADY_ACTIVE` | 409 |
| Business validation, self-decision, missing scope fact, wrong purpose/line match, invalid correction, over-receipt/discrepancy | `SELF_DECISION`, `WAREHOUSE_SCOPE_REQUIRED`, `ISSUE_PURPOSE_MISMATCH`, `ISSUE_NOT_CONFIRMED`, `ISSUE_LINES_MISMATCH`, `PARTNER_INACTIVE`, `CORRECTION_INVALID`, `CORRECTION_REASON_REQUIRED`, `RECEIVING_LINES_MISMATCH`, `RECEIVING_QUANTITY_INVALID`, `RECEIVING_OVER_SENT`, `DISCREPANCY_REASON_REQUIRED` | 422 at domain boundary; HTTP permission/scope failures remain 403 via authz layer |

All confirm actions in T03/T08 must pass the P04 command pipeline with `Idempotency-Key`, then atomically write document/status/version, Inventory movement/balance when nonzero, audit and outbox in **one** transaction. Outbox delivery occurs after commit; transfer/sale never write movement. Runtime HTTP mapping, stock checks and transaction proof belong to T03/T08, not T01.

### 2.1. Cây thư mục route theo cụm chức năng

```text
app/api/v1/
  health/live|ready/
  me/
  organization/                 # M01
  members/
  partners/[id]/connection/
  products/[id]/identifiers/    # M02
  batches/[id]/quality-actions/
  warehouses/
  inventory/balances|movements/
  receipts|issues|transfers|receivings|stocktakes|sales-records/[id]/{confirm,cancel,...}/
  documents/
  approvals/tasks|/[id]/decision/
  lots/[id]/history|trace|qr/   # M04
  public/passport/[token]/
  federation/events|deliveries/
  audit-logs/                   # platform
  reports/inventory-summary|document-counts|open-quality-signals/
  ai/chat|drafts|tool-calls/
  core/records/                 # core API (có thể runtime riêng)
  files/
```

## 3. Ví dụ contract quan trọng

### Confirm phiếu xuất

Input: `POST /api/v1/issues/{id}/confirm`, `Idempotency-Key`, version và lý do nếu rule yêu cầu. Preconditions: actor có quyền tại kho, lot available, stock đủ, approval Flowable đã complete nếu phiếu thuộc quy trình. Output: ID/status/version/confirmedAt và `requestId`; không để client truyền `confirmedBy` hoặc lượng tồn mới. Retry cùng key + payload trả cùng kết quả; key khác nhưng phiếu đã confirmed trả conflict có code ổn định.

### Nhận federation

Input: authenticated partner, message envelope ở `event-contracts.md`. Output `202 Accepted` với technical ACK (`messageId`, `acceptedAt`, trạng thái validated/pending) khi lưu inbox thành công, kể cả replay cùng hash. ACK không có nghĩa đã nhận hàng. Dữ liệu sai schema/auth/hash trả lỗi có requestId và không tạo stock movement.

### Xác nhận thực nhận

Input: local pending transfer ref, `actualLines` theo lô và số lượng, `discrepancyReason` khi khác số gửi, `Idempotency-Key`. Output: receiving status, movement IDs, discrepancy flag; business receipt event được enqueue sau commit. Partial receipt xử lý theo rule D07, không âm thầm biến sent quantity thành actual quantity.

### Product Passport

Output chỉ gồm `productName`, public lot identifier, timeline sự kiện cho phép, issuer/verification status và gap markers. Mọi attachment public có policy riêng; QR token có khả năng revoke. Token không được suy ra private ID hay quyền admin.

## 4. Contract test

Mỗi route có happy path, 401/403, validation, idempotency/replay, concurrency hoặc privacy khi phù hợp. Sinh OpenAPI từ source hoặc duy trì spec có test đối chiếu; khi đổi schema_version làm consumer-driven test giữa A/B/C khác phiên bản. `health/live` chỉ kiểm tiến trình; `health/ready` kiểm dependency thật và không trả secret.

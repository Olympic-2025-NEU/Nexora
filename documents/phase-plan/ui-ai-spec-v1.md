# DX-Lab UI và AI tool blueprint v1

Ứng dụng tầng 2 `apps/dx-lab/` dùng cùng stack Next/React/Tailwind của repo, build riêng, không DB credential. UI ERP trong `app/` có thể reuse component thuần hiển thị; mọi thao tác nghiệp vụ qua gateway API. Đây là route/component/state blueprint, không có mock được tính Done.

## Route và vai trò

ERP canonical surfaces (ADR 0016): `/admin` (org/members only), `/partners`, `/catalog`, `/inventory`, `/trading` (P07+), `/trace` (P08+). Do **not** place products under `/admin`. See `../requirements/SRS-UI-surfaces.md`.

| Vùng | Route đích trong DX-Lab | UI/state bắt buộc | API / ERP surface concepts |
| --- | --- | --- | --- |
| H | `/work`, `/profile`, members/partners management views | Task inbox của tôi, org/role, partner connection metadata; Admin quản user/partner, không hiện secret | `/me`, organization/members; partners surface; core files |
| P | `/operations/receipts`, `/operations/issues`, `/operations/transfers`, `/operations/receivings`, `/work/approvals` | Draft forms có batch picker/quantity; sent-vs-actual; approver khác creator; pending/retry/dispute | M02/M03; ERP `/trading/*` when present |
| D | `/data/inventory`, `/data/lots/[id]`, `/data/impact/[id]` | balance theo lot/kho, timeline A→B→C, backward/forward, provenance/gap/asOf, document/attachment link | inventory/trace; ERP `/inventory/*`, `/catalog/*`, `/trace/*` |
| I | `/assistant` (chat T03, DraftReview **SHIP T04**); panel trên lot/document **HOÃN (R8)** sang T03b hoặc gộp T06 | Q&A nguồn, disambiguation lô, nguồn trích, AI Draft review, provider-down fallback | AI chat/drafts/tool calls |
| Public | `/passport/[token]` | QR mobile, public field allowlist, revoke/expired/unknown state | public Passport only |

`apps/dx-lab/app/(workspace)/...` tổ chức route group, `components/{shell,forms,tables,trace,ai}/` chỉ UI, `lib/api-client/` typed từ OpenAPI. Mỗi route có loading/empty/error/403/409/503; form disable double submit và giữ draft khi request retryable; ETag/version hiển thị conflict và reload. Keyboard focus/labels, mobile 360px, decimal/unit/timezone đúng. Route authorization ở server/API, ẩn navigation chỉ là UX.

## Component contract theo hành trình

- `BatchPicker`: tìm theo SKU/barcode/issuer/expiry, trả `{batchId,productId,unit,qualityStatus,availableQuantity}`; restricted/inspect hiển thị lý do và chặn Issue.
- `DocumentEditor`: lines có warehouse/batch/quantity/unit, validate tại client để phản hồi nhanh nhưng server vẫn quyết định; Draft save không đổi stock; Confirm yêu cầu ETag+Idempotency-Key và có UI state `submitting|pending_approval|approved|confirmed|conflict`.
- `ReceivingCompare`: cột sent/actual/difference và source transfer, required reason khi khác; technical ACK hiển thị trạng thái riêng, không tự điền actual=sent.
- `ApprovalInbox`: task Flowable qua backend, approve/reject reason, creator bị chặn server; engine down hiện chờ, không nút bypass.
- `TraceTimeline/ImpactGraph`: mỗi node có issuer/source ID/occurredAt/verificationState, gap/stale rõ; cycle/depth limit, không suy diễn A verified chỉ từ B assertion.
- `PassportView`: request public projection, không render field raw/private vào DOM/network; QR revoked → 404/expired message an toàn.
- `AiPanel/DraftReview`: sources có timestamp/verification, AI suggestion editable; Draft chỉ sau user review mới mở nút submit/confirm nghiệp vụ thường. Phần `AiPanel` trên lot/document **hoãn theo R8** (T03b hoặc T06); T03 chỉ ship `/assistant` với chip nguồn dạng cấu trúc và fallback `/trace`. `DraftReview` **đã ship trong T04** theo R1–R10: tab riêng trên `/assistant`, receipt only; issue Draft hoãn T04b. Bằng chứng: `evidence/p10-t04.md`.

## AI tool registry và dữ liệu

P10-T02 chọn nhánh **app kiểm quyền từng call**: ERP xác minh Bearer user và membership DB, sau đó gọi API M02/M03/M04 nội bộ bằng chính Bearer đó; mỗi API kiểm lại role và warehouse scope. Python AI chỉ nhận facts đã lọc, không nhận user/Admin token. Registry nội bộ nằm tại `contexts/ai/application/` với năm JSON Schema ở `services/ai/tools/`; không mở public `/ai/tools` route. Mỗi kết quả tối đa 20 record, mỗi call có timeout và ghi `platform.audit_log` action `ai.tool.<name>`/UUID source IDs/outcome đã redacted; quota được giữ bằng audit reservation có PG advisory lock, không tạo bảng `ai_tool_call` mới. P10-T03/T04 sẽ nối chat/Draft route vào registry này.

| Tool | Input | Output | Side effect/quyền |
| --- | --- | --- | --- |
| `getLot` | `{batchId? , originIssuerId?, originLotId?}`; `batchId` **hoặc cặp** issuer+lot là bắt buộc | `{batchId,product,originLot,qualityStatus,sourceIds,asOf}` | read M02 theo user scope; ambiguous → hỏi lại |
| `getStock` | `{batchId,warehouseId?}` | `{balances:[{warehouseId,quantity}],visibleTotalQuantity,unit,asOf,sourceIds,truncated}` | read M02 theo warehouse scope; nếu >20 kho thì `truncated:true` và AI chỉ nói tổng của phần đã trả, không gọi là toàn instance; không trả kho ngoài quyền |
| `getTrace` | `{batchId,direction:'backward'|'forward',depth<=5}` | `{nodes,edges,gaps,verificationStates,sourceIds}` | read M04 theo sharing policy |
| `createReceiptDraft` | `{warehouseId,batchId,quantity,unit,note?}` | `{draftDocumentId,status:'draft',warnings}` | Backend tra productId/baseUnit từ batch, POST M03 với user quyền; idempotency; không movement |
| `createIssueDraft` | `{warehouseId,batchId,quantity,unit,purpose:'partner_transfer'|'sale'|'other',note?}` | `{draftDocumentId,status:'draft',warnings,purpose}` | Backend tra productId/baseUnit từ batch, kiểm quyền/stock nhưng chỉ tạo Draft; nếu AI chưa biết purpose, hỏi hoặc chọn `other` rõ ràng; không submit/confirm |

Không đăng ký `confirm`, `approve`, `changePolicy`, `retryFederation` hay SQL tool. Model output là **đề xuất**, số liệu lấy từ tool output; nếu source thiếu, trả `unknown`/gap thay vì tự tạo số. AI service down/quota hết → 503 an toàn + UI link tra cứu trực tiếp, ERP vẫn làm việc.

Risk rules deterministic v1 **đã ship trong T05**: `expires_on <= today+30d` (near expiry), `quality_status != available` (restricted/inspect), receiving actual<sent (discrepancy), trace có gap/partner_asserted; mỗi alert có `{ruleId,ruleVersion,sourceIds,asOf,severity,explanation}`. Rule không tự đổi status/tồn; thiếu dữ liệu trả `unknown`, `REPEATED_RETRY` hoãn T05b. Bằng chứng: `evidence/p10-t05.md`. Test prompt injection nằm trong product description/partner payload/file text, user không quyền, same lot code khác issuer, provider timeout, AI yêu cầu confirm; output Draft vẫn chưa đổi stock.

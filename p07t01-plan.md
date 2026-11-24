# P07-T01 PLAN — Loại chứng từ và transition contract (Phase 07 · M03 Trading & Distribution)

- **Task:** P07-T01 theo `documents/phase-plan/phase-07-trading.md`
- **Nhánh:** tạo `phase-07` từ `develop` (57c2188); task branch `phase07/p07-t01-transition-contract`
- **Người duyệt plan:** Thịnh · **Người code:** OpenCode · **Người kiểm chứng:** Milo (chạy lại test/typecheck/lint độc lập)
- **Trạng thái:** ĐÃ DUYỆT 2026-11-23 — Thịnh approved.
- **Hội đồng:** LLM Council 5 cố vấn + phản biện chéo (23/11/2026). Plan này là bản chairman tổng hợp, đã tự chốt các điểm hội đồng còn bỏ ngỏ bằng chính tài liệu repo (database-schema-v1.md, workflow-bridge-contract-v1.md, phase-07 doc).

---

## 1. Bối cảnh — cái đã có sẵn, không làm lại

- **Schema đã chốt trong `database-schema-v1.md`:** `trading.document` (status enum `draft, pending_approval, approved, confirmed, cancelled, rejected`; `document_number` server tạo = prefix theo type + date + 12 ký tự UUID, retry khi trùng — KHÔNG dùng số thứ tự trong MVP), `trading.document_line` (sau P06.5: `product_variant_id` bắt buộc, FK `(batch_id, product_variant_id)`; `quantity` / `actual_quantity` / `counted_quantity` theo type; `source_issue_line_id` cho transfer/sale; `source_line_ref` cho receiving), `transfer_detail` (`linked_issue_id` UNIQUE), `receiving_detail`, `sale_detail`. Migration `0006_trading.sql` + repository là **T02**, không thuộc task này.
- **Movement đã có bảng từ P06:** `inventory.stock_movement.kind ∈ ('receipt','issue','receiving','stocktake')`, `delta numeric(20,3)`, unique `(source_line_id, kind)`, append-only.
- **Workflow bridge đã có từ P04-T06:** bảng `platform.approval_request` (state `requested/starting/pending/decision_pending/approved/rejected/cancelled/halted` + halt reasons), service `createRequest / recordDecisionIntent / assertConfirmable → confirmApproval / cancelRequest` (cancel = tombstone), hash dòng `line_snapshot_sha256` tính từ `{lineNo, warehouseId, productId, batchId, quantity, unit}`, confirm so **hash dòng đã duyệt** + `If-Match` version hiện tại riêng (không so version đã submit). FK `approval_request.document_id → trading.document.id` thêm ở T02.
- **Mẫu code phải theo:** guard-only `applyAction` trong `platform/workflow/process.ts` (hàm thuần, không ghi DB); cấu trúc context `contexts/catalog` + `contexts/inventory` (`domain/`, `application/`, `infrastructure/`, `index.ts`); test đơn vị colocated `*.test.ts` chạy trong `npm test`.
- **P06.5 vừa merge:** line tham chiếu `product_variant_id` + qty ở ĐVT gốc; server convert → stock UOM trước Inventory port. UI trading ở `/trading/*` (ADR 0016) — thuộc T03+, không thuộc task này.

## 2. Mục tiêu và phạm vi

**Mục tiêu:** biến spec chữ của P07-T01 thành một contract *thực thi được*: một ma trận transition dạng data trong domain, guard thuần kiểm tra mọi hành động, và bộ test duyệt toàn bộ ma trận — để T02 (schema) và T03 (API) bám vào mà không tự chế luật.

**Trong phạm vi:**
1. `contexts/trading/domain/document.ts` — types + ma trận + guard + bất biến (mục 4 — xem mục 3).
2. `contexts/trading/domain/document.test.ts` — test duyệt toàn bộ ma trận + các case đặt tên theo tiêu chí nghiệm thu.
3. `contexts/trading/index.ts` — export bề mặt domain (theo mẫu catalog/inventory).
4. Cập nhật tài liệu contract: `documents/phase-plan/api-contracts.md` (bảng transition + lỗi), `documents/phase-plan/api-payloads-v1.md` (nếu cần field matrix), mục D14 trong `database-schema-v1.md` + `decision-log.md` (đánh dấu D14 đã đóng ở tầng contract), evidence `documents/phase-plan/evidence/p07-t01.md`.
5. CI: `.github/workflows/ci.yml` — ĐÃ KIỂM TRA: danh sách branches có `phase-*/**`, `phase-04`, `phase04/**` nhưng CHƯA có `phase-07` và `phase07/**` → commit CI là bắt buộc (thêm đúng 2 pattern đó).

**Ngoài phạm vi (chủ sở hữu đã định danh — KHÔNG tick là đã kiểm chứng ở T01):**
- Migration, Prisma schema, repository, trigger bất biến, unique index → **T02**.
- HTTP API/use case/UI, ánh xạ lỗi ra HTTP thật, idempotency ở tầng command → **T03/T08**.
- Nối Flowable end-to-end với chứng từ thật, inbox của Approver → **T07**.
- Bằng chứng DB "Draft/cancel/reject không tạo movement" ở mức stock thật → **T03/T08** (T01 chỉ chứng minh ở tầng contract: các transition đó không tồn tại đường tới confirm và `stockEffect` của chúng là `none`).

## 3. Các chốt thiết kế (chairman rulings)

**R1 — Ma trận là data, tách bạch 3 trục.** `document.ts` export một `DOCUMENT_RULES` frozen: theo từng type — `stockEffect` (D14), `requiresApproval`, tập status tới được, và bảng transition `{from, action, to, actorRule, errorCode}`. Trục status chứng từ, trục state phê duyệt (của bridge), trục stock effect là 3 thứ riêng — không gộp. Kèm glossary ngắn trong file docs: `approved` ≠ `confirmed` (approved = đã qua duyệt; confirmed = đã chốt sổ, lúc đó mới phát sinh movement).

**R2 — Đồ thị status theo từng type, không dùng đồ thị chung.**
- `goods_issue`: draft → pending_approval (submit) → approved (bridge quyết approved) → confirmed (confirm); pending_approval → rejected (bridge quyết rejected); draft/pending_approval/approved → cancelled (cancel; nếu đang pending thì đồng thời tombstone approval request — nghĩa vụ của use case T07, contract ghi rõ).
- 5 type còn lại: draft → confirmed (confirm trực tiếp); draft → cancelled. Các status `pending_approval/approved/rejected` **không tới được** với 5 type này trong V1.
- `rejected` là terminal: sửa sai bằng chứng từ MỚI, không edit-resubmit trên cùng chứng từ.

**R3 — D14 làm rõ điểm nhập kho (chống tính trùng).** `goods_receipt` (+) chỉ dùng cho nhập **nội bộ** (không gắn với transfer của đối tác). Hàng đi qua partner transfer thì đầu nhận chỉ tạo **một** `receiving_confirmation` (+ actual) — cấm tạo thêm goods_receipt cho cùng lô hàng đó. Hai đường nhập là hai sự kiện nghiệp vụ khác nhau, không bao giờ cùng áp lên một lô hàng trong MVP.

**R4 — Độc quyền issue qua `issue_purpose`.** Một goods_issue có đúng một `issue_purpose ∈ (partner_transfer, sale, other)` chốt từ lúc tạo. Transfer chỉ link được issue có purpose `partner_transfer`; sale chỉ link issue có purpose `sale`. Nhờ vậy một issue không thể bị cả transfer lẫn sale dùng chung. Mỗi phía vẫn giữ ràng buộc 1–1: một issue ↔ tối đa một transfer, tối đa một sale (UNIQUE ở T02; guard ở T01 kiểm tra precondition theo purpose + trạng thái link).

**R5 — Phê duyệt là cổng, không phải sự kiện ghi tồn.** Approval không bao giờ tạo movement; chỉ `confirm` mới ghi tồn (ở T03). Confirm của goods_issue có 3 precondition theo bridge contract: (a) approval state = approved (qua `assertConfirmable` của bridge ở tầng use case), (b) hash dòng hiện tại == `line_snapshot_sha256` đã duyệt, (c) quyền hiện thời của actor còn hiệu lực (warehouse scope). Quyết định phê duyệt đến sau khi chứng từ đã cancel: không có tác dụng — chứng từ giữ `cancelled`, bridge xử lý phía engine theo tombstone/halt có sẵn.

**R6 — Không có expiry tự động trong V1.** BPMN `goods-issue-approval` đã pin (D06) không có timer; bridge không có state expiry. Contract ghi thẳng: chứng từ chờ duyệt ở `pending_approval` vô thời hạn cho tới khi có quyết định hoặc bị cancel. KHÔNG bịa cơ chế timeout trong T01; nhu cầu expiry là câu hỏi mở để lại cho T07.

**R7 — Correction là chứng từ mới cùng type, tự chịu vòng đời của nó.** Correction chỉ nhắm vào chứng từ đã `confirmed`; mang `correction_of_document_id` + `correction_reason` (reason rỗng = invalid); đi đúng vòng đời của type đó (là goods_issue thì vẫn phải qua Flowable). Khi correction confirm, movement phát sinh **theo chính các dòng của chứng từ correction** (người lập viết dòng điều chỉnh) — hệ thống KHÔNG tự tính nghịch đảo, KHÔNG tự hoàn tác chứng từ gốc. Correction của correction: được phép, mỗi mắt xích trỏ về chứng từ confirmed liền trước; tại một thời điểm chỉ tối đa một correction chưa-cancel cho một chứng từ gốc (guard contract; unique index một phần là việc T02). Correction của một issue KHÔNG cascade sang transfer/sale đã link — chúng giữ nguyên như lịch sử; chênh lệch xử lý ở luồng đối chiếu/federation (P09).

**R8 — Stocktake: variance tính tại thời điểm confirm.** Dòng stocktake chỉ mang `counted_quantity`. `expected` không phải dữ liệu nhập — là balance đọc trong transaction confirm (T03/T06/T08 thực thi); contract định nghĩa công thức: `delta = counted − balance_at_confirm`, `delta = 0` thì không tạo movement (khớp movement CHECK `delta <> 0`).

**R9 — Field matrix theo type (phần "field" của task).** Contract liệt kê field bắt buộc theo type để T02/T03 không đoán:
- Header chung: `document_type`, `document_number` (server), `created_by_sub`, `correlation_id`; goods_issue thêm `issue_purpose` (bắt buộc, và chỉ goods_issue mới có); correction thêm cặp `correction_of_document_id` + `correction_reason` (cả hai hoặc không cả hai — khớp CHECK trong schema doc).
- Line chung: `warehouse_id`, `batch_id`, `product_variant_id`, `product_id` (denorm), `uom_id`, `line_no`. Theo type: receipt/issue/transfer dùng `quantity`; receiving dùng `quantity` (sent) + `actual_quantity` với `0 ≤ actual ≤ sent` (vượt sent ở V1 → dispute/422, không cộng vượt); stocktake dùng `counted_quantity`.
- Transfer line: copy đúng từng dòng từ issue đã confirm (`source_issue_line_id`), khớp lot/qty **từng dòng**, không chỉ khớp tổng header. Receiving line: mỗi dòng mang `source_line_ref` của transfer nguồn, không bỏ sót/không thêm dòng nguồn.
- Detail: transfer — `destination_partner_id` (partner phải active) + `linked_issue_id`; receiving — `source_issuer_instance_id` + `source_transfer_id`; sale — `linked_issue_id` + `sold_at`, `buyer_ref` tuỳ chọn, không payment/price/PII trong MVP.

**R10 — Taxonomy lỗi.** Guard ném `InvalidTransitionError` (typed, mang `code` + ánh xạ HTTP dự kiến dưới dạng data, không phụ thuộc HTTP): xung đột trạng thái (transition không tồn tại từ status hiện tại, sửa chứng từ đã confirmed, confirm lần hai) → **409**; vi phạm luật nghiệp vụ (approver == creator, reason rỗng, actual > sent, sai purpose khi link, correction nhắm chứng từ chưa confirmed) → **422**. Tầng API (T03) chỉ việc ánh xạ 1–1.

**R11 — Nghĩa vụ platform ghi vào contract (không code ở T01).** Mọi confirm ở T03/T08 phải chạy qua command pipeline P04 với Idempotency-Key, và ghi movement + audit + outbox trong cùng một transaction. Contract nêu rõ đây là postcondition của transition `confirm`, để T03 không "quên" như một tuỳ chọn.

## 4. File plan

| File | Việc |
| --- | --- |
| `contexts/trading/domain/document.ts` | MỚI. Types (`DocumentType`, `DocumentStatus`, `DocumentAction`), `DOCUMENT_RULES` frozen (per-type: stockEffect, requiresApproval, transitions, field requirements), `applyDocumentAction(...)` guard thuần theo mẫu `applyAction`, `InvalidTransitionError`, các guard bất biến: link theo purpose, correction hợp lệ, actual ≤ sent. SPDX header, comment tối thiểu. |
| `contexts/trading/domain/document.test.ts` | MỚI. Test duyệt toàn bộ (type × status × action) sinh từ chính `DOCUMENT_RULES` + bảng kỳ vọng độc lập viết tay cho các ô quan trọng + case đặt tên (mục 6). |
| `contexts/trading/index.ts` | MỚI. Export domain surface. |
| `documents/phase-plan/api-contracts.md` | Thêm bảng transition + taxonomy lỗi 409/422 cho trading documents. |
| `documents/phase-plan/database-schema-v1.md` | Mục D14: bảng movement ownership + làm rõ R3/R4 tại chỗ (sửa chữ tối thiểu, không đổi schema). |
| `documents/phase-plan/decision-log.md` | Đánh dấu D14 closed ở tầng contract (T01), dẫn evidence. |
| `documents/phase-plan/evidence/p07-t01.md` | MỚI. Bằng chứng: lệnh đã chạy, kết quả test, danh sách tiêu chí T01 tick được và tiêu chí hoãn có chủ (T02/T03/T07). |
| `.github/workflows/ci.yml` | Thêm 2 pattern `phase-07` + `phase07/**` vào danh sách branches (đã xác nhận đang thiếu). |
| `documents/phase-plan/phase-07-trading.md` | Tick các checkbox T01 đạt thật ở cuối task (chỉ phần contract). |

## 5. Commit plan (logical, theo thứ tự)

1. `ci: add phase-07 branch triggers` — ci.yml thêm `phase-07` + `phase07/**`.
2. `feat(p07-t01): trading document types and transition matrix` — `document.ts` (types + DOCUMENT_RULES + field matrix) + `index.ts`.
3. `feat(p07-t01): document transition guard and invariants` — guard + InvalidTransitionError + invariant guards trong cùng file hoặc file sibling `transitions.ts` nếu document.ts quá dài (giữ một domain module mạch lạc, không tách vụn).
4. `test(p07-t01): exhaustive transition matrix tests` — `document.test.ts`.
5. `docs(p07-t01): close D14 in trading contract docs` — api-contracts + schema doc + decision-log.
6. `docs(p07-t01): evidence and phase-07 checkboxes` — evidence file + tick checkbox đúng phạm vi.

Merge: sau khi Milo kiểm chứng xanh → merge `--no-ff` vào `phase-07`, push cả hai nhánh, **giữ** task branch (luật merge 2026-11-20). OpenCode KHÔNG tự merge, KHÔNG push.

## 6. Kiểm chứng (Milo tự chạy lại, không tin self-report)

- `npm test` — toàn bộ suite cũ + test mới; test mới phải duyệt đủ 6 type × 6 status × action set và FAIL nếu ai sửa matrix mà không sửa kỳ vọng (test sinh từ matrix + bảng kỳ vọng độc lập viết tay cho các ô quan trọng — tránh test tự khẳng định chính nó).
- Các case đặt tên bắt buộc: draft/cancel/reject → stockEffect none và không có đường tới confirm ngoài luật; confirmed không có transition edit/cancel/delete; approver == creator → 422; correction nhắm draft → 422; correction thiếu reason → 422; receiving actual > sent → 422; transfer link issue purpose=sale → 422; goods_issue confirm từ draft (chưa approved) → 409; 5 type không-issue vào pending_approval → 409.
- `npm run typecheck`, `npm run lint` (CI dùng `--max-warnings=0`).
- Milo đọc tay: đối chiếu `DOCUMENT_RULES` với bảng schema trong `database-schema-v1.md` (enum, CHECK) và với workflow-bridge-contract (hash, tombstone) — lệch một chữ cũng tính là fail.
- CI trên nhánh phase-07 xanh mới coi là xong.

## 7. Rủi ro / điểm mù hội đồng đã bắt và cách plan xử lý

- **"Chứng nhận hộ" việc của T02/T03** (Contrarian): plan tách rõ tick-box (mục 2) — T01 không tuyên bố đã kiểm chứng HTTP/DB/Flowable thật.
- **Tính trùng nhập kho + cấp phát trùng transfer/sale**: chốt ở R3/R4.
- **Vòng đời phê duyệt mơ hồ**: chốt ở R2/R5/R6 — ai confirm, so hash gì, reject là terminal, không expiry trong V1.
- **Correction là lỗ hổng hoàn tác**: chốt ở R7 — movement theo dòng của chính chứng từ correction, không tự nghịch đảo, không cascade.
- **Baseline stocktake trôi**: chốt ở R8 — expected đọc tại confirm.
- **Quên field contract + quên idempotency**: bổ sung R9/R11.

## 8. Lệnh cho OpenCode

- Làm việc **chỉ** trong `~/nexora-clean-check`, nhánh `phase07/p07-t01-transition-contract`. Không đọc/ghi ngoài thư mục dự án, không đọc `deploy/instances/*.env`. Nếu một tool bị từ chối quyền: bỏ qua và làm tiếp, không dừng.
- Không sửa các file plan untracked ở gốc repo (`p03*.md`, `p04*.md`, `p07t01-plan.md`). Không thêm dependency mới. Mọi file nguồn mới có header SPDX 1 dòng. Comment tối thiểu hoặc không.
- Theo đúng thứ tự commit ở mục 5; mỗi commit xong chạy `npm test` liên quan trước khi đi tiếp. Xong việc: viết evidence `p07-t01.md` trung thực (cái gì chưa làm thì ghi chưa làm), KHÔNG tự merge, KHÔNG push.

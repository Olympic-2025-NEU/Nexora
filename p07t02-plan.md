# P07-T02 PLAN — Migration và repository chứng từ (Phase 07 · M03 Trading & Distribution)

- **Task:** P07-T02 theo `documents/phase-plan/phase-07-trading.md`
- **Nhánh:** task branch `phase07/p07-t02-trading-persistence` tách từ `phase-07` (326aa8b)
- **Người duyệt plan:** Thịnh · **Người code:** OpenCode · **Người kiểm chứng:** Milo (tự chạy lại test tích hợp DB + test/typecheck/lint, đọc tay SQL trigger)
- **Trạng thái:** ĐÃ DUYỆT 2026-11-23 — Thịnh approved.
- **Hội đồng:** LLM Council 5 cố vấn + 6 phản biện chéo (23/11/2026). Chairman tổng hợp; các điểm hội đồng bỏ ngỏ đã được chốt ở mục 3 bằng cơ chế PostgreSQL/Prisma thực tế của repo.

---

## 1. Bối cảnh — cái đã có, không làm lại

- **T01 đã xong:** `contexts/trading/domain/document.ts` (ma trận transition + guard + D14) đã merge vào `phase-07`, CI xanh. T02 xây tầng lưu trữ bên dưới contract đó.
- **Spec schema đã chốt** trong `database-schema-v1.md` mục P07: `trading.document`, `trading.document_line`, `trading.transfer_detail`, `trading.receiving_detail`, `trading.sale_detail` — đầy đủ cột, CHECK, unique, index. Tên "0006_trading.sql" trong tài liệu là tên khái niệm; repo dùng migration Prisma thư mục timestamp — xem chốt R2.
- **Quy ước repo:** `prisma/schema.prisma` (models + `@@schema`), migration là thư mục timestamp chứa `migration.sql` SQL tay (CHECK/trigger/grant nằm ngoài khả năng sinh của Prisma). Migration mới nhất hiện tại: `20261122141000_variant_code_delete_grant`. Test tích hợp platform chạy trên Postgres tạm (container dùng-một-lần + `tests/platform/bootstrap.sql` + `prisma migrate deploy`); `tests/platform/schema.integration.mjs` chứa danh sách bảng **toàn bộ** — thêm bảng mà không cập nhật danh sách này thì job CI platform-schema fail.
- **Vai trò DB:** migrator sở hữu DDL + seed; `app_runtime` bị giới hạn grant tường minh theo từng migration (deny-by-default). Seed org/membership phải bằng migrator (app_runtime không có INSERT ở vài bảng).
- **FK composite đã có chỗ dựa:** `inventory.stock_movement` đã có FK `(batch_id, product_variant_id) → catalog.batch` từ P06.5, tức unique `(id, product_variant_id)` trên `catalog.batch` đã tồn tại — T02 vẫn phải kiểm chứng lại ở bước 0 trước khi trỏ FK của `document_line` vào.

## 2. Mục tiêu và phạm vi

**Mục tiêu:** biến contract T01 thành **luật ở tầng database**: chứng từ đã `confirmed` thì buộc phải đầy đủ và hợp lệ — bất kỳ đường ghi nào (API sau này, script, SQL tay) cũng không tạo được "confirmed nhưng sai". Repository là plumbing trung thực trên transaction của người gọi.

**Trong phạm vi:**
1. Models Prisma cho 5 bảng trading + 2 FK xuyên phase còn nợ (`inventory.stock_movement.source_line_id → trading.document_line.id`; `platform.approval_request.document_id → trading.document.id`).
2. Migration SQL tay: CHECK/unique/partial unique/index, deferred constraint trigger kiểm chứng khi confirm, trigger bất biến cho chứng từ đã confirmed, grant tường minh cho `app_runtime`.
3. `contexts/trading/infrastructure/prisma-repos.ts` — repository nhận transaction client của người gọi, không tự mở transaction.
4. Test tích hợp: cập nhật danh sách bảng toàn bộ + bộ test **tấn công DB bằng SQL thô** (mục 6) + drill migrate-từ-rỗng và backup/restore.
5. Cập nhật `database-schema-v1.md` (bảng kê luật của trigger), evidence `documents/phase-plan/evidence/p07-t02.md`, tick checkbox T02 đúng phạm vi.

**Ngoài phạm vi:** use case/API/UI (T03+), ghi movement thật (T03), nối Flowable (T07), read-model lịch sử chứng từ (T08). Repository ở T02 **không** chứa logic transition — nó chỉ lưu/đọc; luật transition vẫn của domain T01 + trigger DB.

## 3. Các chốt thiết kế (chairman rulings)

**R1 — Trigger là sản phẩm chính; cơ chế kích hoạt phải đúng.** Một hàm kiểm chứng duy nhất `trading.validate_confirmed_document(doc_id)` + **constraint trigger DEFERRABLE INITIALLY DEFERRED trên cả 5 bảng** (document, document_line, transfer_detail, receiving_detail, sale_detail) AFTER INSERT/UPDATE/DELETE — để mọi thay đổi chạm vào một chứng từ (kể cả line insert *sau khi* header đã lật confirmed trong cùng transaction) đều kéo chứng từ đó vào vòng kiểm chứng tại commit. Hàm chỉ kiểm chứng khi status hiện tại của chứng từ = `confirmed`; draft/cancelled/rejected bỏ qua. Nội dung kiểm chứng đúng spec schema doc: ≥1 line; field bắt buộc theo type (line: quantity/actual/counted theo type; detail bắt buộc theo type); `uom_id` ∈ variant_uoms của variant; transfer/sale: từng line khớp line của issue đã link (lot/qty/UOM/variant qua `source_issue_line_id`); receiving: mọi line có `source_line_ref`, `0 ≤ actual ≤ quantity`, `sent_quantity = SUM(line.quantity)`, `actual_quantity = SUM(line.actual_quantity)`, discrepancy_reason bắt buộc khi actual ≠ sent.

**R2 — Tên migration theo quy ước repo:** thư mục timestamp mới (định dạng `YYYYMMDDHHMMSS_trading_documents`, sau `20261122141000`), KHÔNG đặt tên `0006_trading.sql`. Ghi chú tương ứng vào evidence để đối chiếu với tài liệu phase.

**R3 — Đặt tên luật tường minh = hợp đồng lỗi cho T03.** Mọi CHECK/unique/trigger đặt tên có chủ đích (`ck_trading_*`, `uq_trading_*`, `trg_trading_*`). Hàm kiểm chứng RAISE với thông điệp ổn định theo từng luật (prefix `trading_confirm:` + mã luật, ví dụ `trading_confirm:no_lines`, `trading_confirm:uom_not_allowed`, `trading_confirm:line_mismatch`, `trading_confirm:actual_out_of_range`, `trading_confirm:missing_detail`). `database-schema-v1.md` bổ sung **bảng kê luật** ánh xạ 1–1: mã luật ↔ điều kiện ↔ bảng/cột — T03 map sang 409/422 theo bảng này, không đoán.

**R4 — Bất biến confirmed: trigger là lớp quyết định, grant là lớp phụ.** Trigger BEFORE UPDATE/DELETE (không deferred):
- `trading.document`: chặn UPDATE/DELETE khi `OLD.status = 'confirmed'` (lần UPDATE lật *vào* confirmed vẫn được phép vì OLD chưa confirmed; sau đó khoá hẳn).
- `trading.document_line`: chặn UPDATE/DELETE khi chứng từ cha đã confirmed; chặn INSERT vào chứng từ đã confirmed.
- `transfer_detail`: sau confirm chỉ cho UPDATE `delivery_state`, `technical_ack_at`, `business_receipt_at` (luồng federation T04 cần); các cột còn lại khoá. `receiving_detail`/`sale_detail`: khoá toàn bộ sau confirm.
- Grant `app_runtime` tường minh từng bảng (SELECT/INSERT/UPDATE theo đúng nhu cầu trên; **không** cấp DELETE cho `document`, không cấp UPDATE cho `sale_detail` ngoài nhu cầu). Evidence phải ghi rõ lớp nào bảo đảm điều gì: grant chặn đường đi thẳng của app; trigger chặn cả khi role có quyền ghi draft (và là lớp duy nhất có hiệu lực bất kể ai ghi). Owner/migrator ngoài runtime không thuộc tuyên bố bất biến.

**R5 — document_number: retry thuộc về người gọi, không nằm trong transaction.** PostgreSQL: unique violation làm **hỏng toàn bộ transaction** hiện tại — repository không thể bắt lỗi rồi retry bên trong transaction của người gọi (Prisma cũng không phơi savepoint sạch). Chốt: repository cung cấp `nextDocumentNumber(type)` (prefix theo type + ngày + 12 ký tự UUID) và `createDocument` ném lỗi typed `TradingUniqueViolation` (mang tên constraint) khi trùng; việc retry **toàn bộ transaction** (tối đa 3 lần) là trách nhiệm của use case ở T03. Không cài retry ngầm trong repository.

**R6 — Partial unique correction phải kín theo đúng nghĩa đen.** `CREATE UNIQUE INDEX uq_trading_one_active_correction ON trading.document (correction_of_document_id) WHERE correction_of_document_id IS NOT NULL AND status <> 'cancelled'`. Test phải gồm: hai correction đồng thời (hai transaction song song) cho cùng một gốc → đúng một cái commit được; cancel correction cũ rồi tạo correction mới → được.

**R7 — Detail phải khớp type của chứng từ cha.** Trigger BEFORE INSERT/UPDATE trên 3 bảng detail: `transfer_detail` chỉ gắn với document_type `partner_transfer` và `linked_issue` là goods_issue có `issue_purpose='partner_transfer'`; `sale_detail` tương tự với `sale_record`/`sale`; `receiving_detail` chỉ gắn `receiving_confirmation`. Sai type → reject ngay ở statement, không đợi deferred.

**R8 — "Snapshot" được định nghĩa hẹp và hết mơ hồ.** Snapshot duy nhất trong T02 là `document_line.product_id` (denorm từ variant tại lúc ghi line, theo schema doc) + `document_number` bất biến. KHÔNG có snapshot giá/tên partner/UOM-text trong MVP (schema doc không có các cột đó — không tự thêm).

**R9 — Preflight trước khi gắn 2 FK xuyên phase.** Hai FK được thêm dạng chuẩn (có validate) vì đường nâng cấp được hỗ trợ của dự án là **bootstrap từ DB rỗng** (migrate deploy chạy toàn chuỗi từ đầu — đúng cách các stack P04/P06 đã dựng); evidence ghi rõ: DB dev cũ có dữ liệu approval/movement thử nghiệm với document_id tổng hợp sẽ không qua được validate — phải bootstrap lại, không vá dữ liệu. Đây là giới hạn có chủ đích, ghi thành văn bản chứ không im lặng.

**R10 — Prisma drift được kiểm soát, không để âm thầm.** Sau khi sửa tay `migration.sql`: chạy `prisma migrate deploy` từ DB rỗng + `prisma migrate status` + `prisma generate` thành công. Ghi vào schema doc + evidence: các trigger/partial unique/CHECK nâng cao **chỉ** sống trong migration SQL; các migration sau này cấm sinh lại bảng trading từ schema.prisma (schema.prisma là hình chiếu để generate client, không phải nguồn sự thật cho ràng buộc nâng cao).

**R11 — Fixture cho test tấn công.** Test tích hợp tự seed bằng SQL (vai migrator) trong harness Postgres tạm: org + partner (active), warehouse, product + variant + variant_uoms (ít nhất 2 UOM: 1 hợp lệ, 1 không), batch thuộc variant, một issue đã confirmed làm gốc cho transfer/sale. Các case tấn công chạy bằng **SQL thô qua vai `app_runtime`** (không qua repository) — repository test riêng chỉ kiểm: tạo/đọc aggregate, version tăng, không tự mở transaction (gọi repo trong một transaction ngoài rồi rollback → dữ liệu biến mất chứng minh repo dùng tx của người gọi).

## 4. File plan

| File | Việc |
| --- | --- |
| `prisma/schema.prisma` | Thêm 5 model trading (`@@schema("trading")`) + quan hệ cho 2 FK xuyên phase; giữ style đặt tên như catalog/inventory. |
| `prisma/migrations/<timestamp>_trading_documents/migration.sql` | Sinh khung bằng Prisma rồi viết tay toàn bộ: CREATE TABLE/CHECK/unique/index theo schema doc, 2 FK xuyên phase, partial unique correction (R6), trigger detail-type (R7), hàm + constraint triggers kiểm chứng confirm (R1), trigger bất biến (R4), grants (R4). |
| `contexts/trading/infrastructure/prisma-repos.ts` | MỚI. Repository: createDocument (sinh số theo R5), replaceLines cho draft, attachDetail, getAggregate (header+lines+detail), list theo status/type/time (dùng index đã khai). Mọi method nhận `tx` bắt buộc. |
| `contexts/trading/index.ts` | Export thêm repository factory + types (giữ nguyên export domain T01). |
| `tests/platform/schema.integration.mjs` | Thêm 5 bảng trading vào danh sách toàn bộ + các case tấn công DB (mục 6). Nếu harness có file test riêng cho trading thì theo đúng pattern đặt tên sẵn có của tests/platform. |
| `documents/phase-plan/database-schema-v1.md` | Thêm bảng kê luật trigger (R3) + ghi chú drift (R10) + định nghĩa snapshot (R8). |
| `documents/phase-plan/evidence/p07-t02.md` | MỚI. Lệnh + kết quả thật, gồm: migrate từ rỗng, drill backup/restore, preflight FK (R9), danh sách checkbox tick được/chưa. |
| `documents/phase-plan/evidence/source-inventory.json` | Refresh sau khi thêm file nguồn mới (bài học T01: `check-spdx` fail nếu quên). |
| `documents/phase-plan/phase-07-trading.md` | Tick 3 checkbox T02 khi đạt thật. |

## 5. Commit plan (logical, theo thứ tự)

1. `feat(p07-t02): trading document models and migration` — schema.prisma + migration.sql phần bảng/CHECK/unique/index + 2 FK xuyên phase.
2. `feat(p07-t02): deferred confirm validation and immutability triggers` — hàm kiểm chứng + constraint triggers + trigger bất biến + trigger detail-type + grants (commit này là tâm điểm review — tách riêng).
3. `feat(p07-t02): trading document repositories` — prisma-repos.ts + index.ts exports (+ refresh source-inventory nếu check-spdx yêu cầu).
4. `test(p07-t02): trading schema attacks and migration drills` — danh sách bảng toàn bộ + test tấn công + drill từ-rỗng/restore (script/test trong tests/platform).
5. `docs(p07-t02): D14 rule inventory, evidence and checkboxes` — schema doc bảng kê luật + evidence + tick checkbox.

Merge: Milo kiểm chứng xanh → merge `--no-ff` vào `phase-07`, push cả hai nhánh, giữ task branch. OpenCode KHÔNG tự merge, KHÔNG push.

## 6. Kiểm chứng (Milo tự chạy lại)

- Harness Postgres tạm theo pattern sẵn có (`tests/platform/run-*.sh` tương ứng): `prisma migrate deploy` từ DB trống thành công; chạy lại deploy lần hai không lỗi.
- **Bộ test tấn công (SQL thô, vai app_runtime) — mỗi case phải bị DB từ chối:**
  1. Confirm chứng từ 0 line → deferred trigger abort.
  2. Confirm goods_receipt mà line thiếu quantity → abort; stocktake thiếu counted_quantity → abort; receiving line thiếu actual_quantity → abort.
  3. Line dùng UOM không thuộc variant_uoms → abort khi confirm.
  4. Transfer line lệch qty/lot so với issue đã link → abort; sale link issue có purpose `partner_transfer` → reject (R7).
  5. Receiving actual > sent → abort; actual ≠ sent mà thiếu discrepancy_reason → abort; sent_quantity khai không bằng SUM(lines) → abort.
  6. UPDATE một field của document đã confirmed → trigger chặn; INSERT line vào document đã confirmed → chặn; DELETE line của document đã confirmed → chặn; UPDATE `delivery_state` của transfer đã confirmed → **được phép** (case dương tính bắt buộc).
  7. Tạo 2 correction song song cho cùng một gốc → 1 commit, 1 bị unique chặn; cancel correction 1 rồi tạo correction mới → được.
  8. Draft thiếu field vẫn INSERT/commit được (deferred trigger không chặn draft) — case dương tính bắt buộc.
  9. document_number trùng (insert tay cùng type+number) → unique chặn.
- Drill backup/restore: `pg_dump` DB vừa migrate → restore sang DB trắng khác → chạy lại test schema cơ bản + kiểm tra trigger còn tồn tại (query `pg_trigger`).
- Repository: rollback transaction ngoài làm mất dữ liệu repo vừa ghi (chứng minh không tự mở transaction); version tăng sau update draft.
- `npm test`, `npm run typecheck`, `npm run lint` xanh; Milo đọc tay toàn bộ `migration.sql` đối chiếu schema doc từng CHECK/unique/index.

## 7. Rủi ro hội đồng đã bắt và cách plan xử lý

- **Trigger deferred là điểm chết** (Contrarian): cơ chế touched-set trên cả 5 bảng (R1), thông điệp lỗi theo mã luật (R3), test tấn công bằng SQL thô (mục 6) — lỗi tại commit được truy về đúng luật.
- **Retry document_number mâu thuẫn transaction của người gọi** (cả 6 phản biện cùng bắt): chốt R5 — retry toàn transaction thuộc về use case T03.
- **Quên danh sách bảng toàn bộ / quên grant / quên refresh source-inventory**: đưa thành bước tường minh trong file plan + commit plan.
- **FK composite thiếu unique đỡ**: kiểm chứng ở bước 0 (mục 1) trước khi viết FK.
- **"Immutable"/"snapshot" mơ hồ**: định nghĩa lớp bảo đảm (R4) và phạm vi snapshot (R8) thành văn bản trong schema doc.

## 8. Lệnh cho OpenCode

- Làm việc **chỉ** trong `~/nexora-clean-check`, nhánh `phase07/p07-t02-trading-persistence`. Không đọc/ghi ngoài thư mục dự án, không đọc `deploy/instances/*.env`. Tool bị từ chối quyền: bỏ qua, làm tiếp.
- Không sửa các file plan untracked ở gốc repo. Không thêm dependency. File nguồn mới có header SPDX 1 dòng. Comment tối thiểu hoặc không.
- Việc nặng về Docker/Postgres (chạy harness, drill restore): nếu môi trường OpenCode không làm được thì ghi rõ vào evidence là chưa chạy và để nguyên cho Milo chạy — KHÔNG bịa kết quả, KHÔNG tick checkbox chưa kiểm chứng.
- Theo thứ tự commit mục 5; xong việc viết evidence trung thực, KHÔNG tự merge, KHÔNG push.

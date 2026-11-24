# P07-T06 — Stocktake và sale record tối thiểu — KẾ HOẠCH (đã qua LLM Council)

Trạng thái: ĐÃ DUYỆT (Thịnh duyệt 2026-11-23). Sau khi Thịnh duyệt: OpenCode chạy trên nhánh mới `phase07/p07-t06-stocktake-sale` từ `phase-07` (@ b722eed). Milo kiểm chứng độc lập (gồm `npm run build`), merge `--no-ff` vào `phase-07`, giữ nhánh task, chờ CI.

## Nguồn sự thật
- `documents/phase-plan/phase-07-trading.md` mục P07-T06 + dòng AI handover (T06); `api-payloads-v1.md` dòng stocktakes + sales-records; `event-payloads-v1.md` (bảng event nội bộ + dòng downstream.impact.v1).
- P07-T01 R8: stocktake delta = counted − balance đọc lúc confirm; delta 0 ⇒ không movement. T01 R4: sale chỉ link issue có purpose 'sale'.
- T02 schema: line của stocktake dùng `counted_quantity` (guard: confirmed stocktake bắt counted NOT NULL; `quantity` của line stocktake là NULL theo thiết kế và có CHECK ≥ 0); `sale_detail` (linked_issue_id + UNIQUE thuần `uq_trading_sale_issue` — cái bẫy lần thứ ba; buyer_ref TEXT nullable; sold_at NOT NULL; DB guard đã chặn sale link issue sai purpose).
- Máy móc sẵn có: pipeline runCommand + Idempotency-Key; `tradingUnitOfWork` (khóa document FOR UPDATE + khóa balance theo thứ tự đã sắp); `adjustStock` với neo UNIQUE (source_line_id, kind); module quy đổi UOM của T03 (rewrite về stock UOM tại submit/confirm, Decimal HALF_UP 3dp, quy về 0.000 → 422); pattern T04/T05 cho link uniqueness (bỏ UNIQUE thuần, deferred constraint trigger — một link ĐANG HOẠT ĐỘNG, cancel giải phóng nguồn); event nội bộ qua registry ở composition/trading.ts (destination traceability).

## R0 — Bước 0 bắt buộc (đọc code trước, ghi vào evidence, không đoán)
1. Inventory movement kinds: có kind điều chỉnh (adjustment/stocktake) chưa; chữ ký `adjustStock` với delta ÂM (dấu, floor, tạo dòng balance thiếu như receipt) và neo (source_line_id, kind) cho line stocktake.
2. Text chính xác của trigger T02 cho line stocktake lúc confirm: chỉ đòi counted NOT NULL hay còn đòi quantity phải NULL — chốt việc quantity KHÔNG bị đụng vào (R2).
3. Convention độ dài tối đa cho các ref text trong repo (áp cho buyer_ref) + cách T05/T03 đặt tên typed errors.
4. Điểm tái dùng của hàm quy đổi UOM (T03 checklist/conversion) cho counted_quantity.
5. Cơ chế đăng ký event nội bộ mới: schema JSON trong contracts/events + registry ở composition/trading.ts (theo mẫu T05 đã nới schema receipt).
6. Guard của sale_detail (purpose) chạy ở tầng nào và repo đọc issue/purpose/status/scope hiện có.

## R1 — Stocktake confirm: quy đổi tại confirm, delta dưới khóa, reason khi có chênh
- Draft lưu counted như đã nhập (kèm uomId). Confirm (trong tradingUnitOfWork): khóa dòng document → CAS draft→confirmed → kiểm lại scope kho HIỆN TẠI → quy đổi từng line về stock UOM bằng đúng module T03 (ghi lại counted_quantity + uom_id trong cùng tx — stored = posted; số đã nhập theo packing không giữ lại, trade-off đã chấp nhận ở T03) → khóa các dòng balance theo thứ tự (warehouse, batch) đã sắp, dòng thiếu = 0 → delta = counted − balance cho từng line → line delta ≠ 0: một movement điều chỉnh (kind theo R0.1) với neo line; line delta = 0: KHÔNG movement → hậu kiểm: balance sau điều chỉnh == counted cho mọi line.
- Reason: `note` của document phải khác rỗng ở confirm khi BẤT KỲ line nào có delta ≠ 0 → thiếu thì **422 STOCKTAKE_REASON_REQUIRED** (typed, trước trigger DB). Toàn bộ delta = 0 thì không cần reason.
- Corrections (correctionOfDocumentId/correctionReason): chỉ validate link như T03 R7, không cascade.

## R2 — Bộ ba (system, counted, delta) sống trong EVENT mới — quantity giữ NULL
- Thêm event nội bộ **`trading.stocktake.confirmed.v1`** (mở rộng contract theo đúng pattern họ event, ghi rõ trong evidence như vụ nới lines=[] ở T05): schema JSON mới + registry (destination traceability). Payload: {eventId, documentId, documentVersion, lines: [{lineId, batchId, warehouseId, systemQuantity, countedQuantity, delta, unit}] — **MỌI line kể cả delta = 0**, actorSub, reason (note), occurredAt}. Số dạng string thập phân như các event khác.
- `line.quantity` GIỮ NGUYÊN NULL cho stocktake (không nạp snapshot vào quantity — cột đó có ngữ nghĩa riêng cho các loại chứng từ khác; nạp vào là làm bẩn ngữ nghĩa dùng chung). Read model chi tiết sau confirm đọc bộ ba TỪ payload event đã lưu trong outbox (như khối announcement của T04), không tính lại từ balance sống.

## R3 — Approval cho stocktake: ĐÓNG điều kiện "nếu D06 chọn" = KHÔNG ở v1, ghi rõ rủi ro
- D06/ADR 0006 chỉ ghim Flowable cho goods issue; không tồn tại BPMN hay ngưỡng nào cho stocktake; bịa ngưỡng là bịa quy tắc nghiệp vụ. T06 KHÔNG làm approval cho stocktake; ghi quyết định + lý do vào evidence và phase doc để điều kiện của spec được đóng visibly.
- Rủi ro được chấp nhận và phải ghi tên trong evidence: người đếm được tự confirm (self-confirm) — một người có thể "tìm thấy" tồn và tự duyệt. Giảm thiểu hiện có: policy theo action `trading:stocktake:create|read|update|confirm|cancel` vẫn đăng ký đủ; creator và confirmer đều được ghi (document fields + audit); dữ liệu variance của v1 là cơ sở để đặt ngưỡng thật sau này nếu cần.

## R4 — Rule cho line stocktake
- Trùng cặp (warehouseId, batchId) trong cùng một document → **422 DUPLICATE_LINE** ở create và PATCH (kiểm tầng app; gộp hai lần đếm một lô là che lỗi đếm).
- Batch không tồn tại → 422 BATCH_NOT_FOUND; variant của line ≠ variant của batch → 422 BATCH_VARIANT_MISMATCH.
- Batch chưa có dòng balance (hệ thống = 0) mà đếm > 0: HỢP LỆ (found stock) — adjustStock tạo dòng balance như receipt.
- Batch hết hạn / bị quarantine: VẪN ĐẾM VÀ ĐIỀU CHỈNH ĐƯỢC — kiểm kê là quan sát thực tế; điều chỉnh không đổi quality status. Đây là điểm khác receipt/issue (chặn ở confirm) — ghi rõ divergence trong evidence.
- Scope kho kiểm ở create/PATCH và kiểm LẠI ở confirm (403).

## R5 — Sale: một sale ĐANG HOẠT ĐỘNG cho mỗi issue (áp pattern lần thứ ba)
- Migration: bỏ `uq_trading_sale_issue`; deferred constraint trigger (hàm + trigger trên sale_detail VÀ document, đúng mẫu 20261123020000/20261123030000) — một sale có status <> 'cancelled' cho mỗi linked_issue_id; sale đã confirm chiếm issue vĩnh viễn; draft cancel → tạo lại được. Bỏ `@unique` trong schema.prisma; cập nhật schema battery. Từ T06, "một link đang hoạt động cho mỗi nguồn" là bất biến kiến trúc có tên của codebase — ghi vào evidence.

## R6 — Sale create/confirm: chứng thực, không động vào tồn
- Create validate theo thứ tự: issue không tồn tại → **422 ISSUE_NOT_FOUND**; purpose ≠ 'sale' → **422 ISSUE_WRONG_PURPOSE** (DB guard là chốt hậu); issue chưa confirmed → **409 ISSUE_NOT_CONFIRMED**; đã có sale đang hoạt động → **409 SALE_ALREADY_EXISTS**. Server copy lines từ issue (như transfer); scope kiểm trên các warehouse của issue.
- `sold_at`: client không gửi → server lấy now() tại create (cột NOT NULL thắng chữ "optional" của API); client gửi thời gian TƯƠNG LAI → **422 INVALID_SOLD_AT**. Không có PATCH — sai thì cancel/tạo lại.
- `buyer_ref`: trim + giới hạn độ dài theo convention ở R0.3 (vượt → 422 BUYER_REF_TOO_LONG); là mã tham chiếu mờ (opaque external reference) — tài liệu/UI ghi rõ không nhập tên/số điện thoại/thông tin thanh toán; T06 không đưa buyer_ref vào bất kỳ payload partner nào (không phát event federation nào cả).
- Confirm tx: khóa sale document → CAS → kiểm lại issue vẫn confirmed + scope hiện tại của actor → set confirmed_by/at → emit ĐÚNG MỘT outbox row `trading.sale.recorded.v1` (theo contract: {eventId, saleId, linkedIssueId, lines, occurredAt}, destination traceability). Module sale KHÔNG import inventory port — zero movement theo cấu trúc (như transfers.ts ở T04), acceptance test chứng minh bằng số movement không đổi.

## R7 — Event federation: KHÔNG có ở T06
- `downstream.impact.v1` KHÔNG được tạo ở T06 — kể cả bản "giữ pending có điều kiện": đó là relay chịu policy chia sẻ của P09, và buyer_ref dạng text tự do không "resolve" thành partner được. Ghi deferral trong evidence.

## R8 — UI (app/trading/stocktakes/, app/trading/sales/)
- Stocktakes: list (status, tổng variance); create/edit dùng line editor của T03 — batch picker hiển thị balance hiện tại kèm nhãn rõ ràng "chỉ tham khảo — confirm sẽ đọc lại balance" + thời điểm đọc; detail sau confirm: bảng system/counted/delta theo line đọc từ event đã lưu (R2) + movement id cho line có điều chỉnh; ô note/reason được nhấn khi có variance.
- Sales: list; create với issue picker do server lọc (confirmed + purpose 'sale' + chưa có sale đang hoạt động), lines copy hiển thị read-only, buyer_ref + sold_at; detail: lines + tham chiếu issue nguồn + dòng chứng minh hiệu ứng tồn ("issue: 6 → 4; sale: 4 → 4 — sale không trừ tồn"). Chuỗi A→B→C đầy đủ là việc của M04/T08 — T06 chỉ hiển thị phần sale tự chứng minh được.
- Cả hai trang [id] có `export const instant = false`; `npm run build` là gate cứng (bài học CI T04).

## Commits (đúng thứ tự, mỗi commit tự xanh test+typecheck+lint; build ở commit UI)
1. `feat(p07-t06): one active sale per issue uniqueness` — migration R5 + schema.prisma + schema battery.
2. `feat(p07-t06): stocktake create and edit` — use cases + routes + policies + validations R4.
3. `feat(p07-t06): stocktake confirm posts signed adjustments` — confirm R1 + event R2 (schema + registry) + battery stocktake.
4. `feat(p07-t06): sale record from confirmed issue` — create/confirm/cancel R6 + battery sale (gồm acceptance chain).
5. `feat(p07-t06): trading stocktake and sale pages` — UI R8; `npm run build` pass.
6. `docs(p07-t06): evidence and phase checkboxes` — evidence trung thực: R3 deferral + rủi ro self-confirm được ghi tên; divergence batch hết hạn (R4); mở rộng contract event stocktake (R2); downstream.impact defer (R7); checkbox UI chỉ tick khi code xong — ghi rõ chưa chạy browser journey nếu chưa chạy.

## Kiểm chứng (Milo chạy lại độc lập, không tin self-report)
- `npm test`, `npm run typecheck`, `npm run lint`, **`npm run build`**.
- `npm run test:platform:schema` (migration sale + battery cancel/tạo lại).
- `npm run test:platform:trading` — TUẦN TỰ, không song song với schema:
  - Stocktake: balance 10 đếm 7 → movement −3, balance 7; đếm 12 → +2; line delta 0 → không movement nhưng CÓ trong event; confirm toàn delta 0 → event đủ lines, 0 movement, không cần reason; có variance mà thiếu note → 422; batch chưa có balance đếm 5 → +5 tạo balance; trùng line → 422; batch hết hạn vẫn đếm được; quy đổi packing→stock UOM đúng tại confirm; hai confirm đồng thời → một thắng; replay cùng key không nhân đôi.
  - Sale (acceptance): receipt → balance 6 → issue purpose 'sale' 2 qua duyệt thật → balance 4 → sale create + confirm → balance VẪN 4, tổng số movement không đổi, đúng 1 event recorded; issue sai purpose → 422; issue chưa confirm → 409; sale thứ hai đang hoạt động → 409; cancel draft → tạo lại thành công; sold_at tương lai → 422.

## Ngoài phạm vi (ghi rõ)
- Approval/threshold cho stocktake (R3 — đóng điều kiện của spec, không phải quên).
- downstream.impact.v1 và mọi relay federation → P09.
- POS/giá/thanh toán/finance cho sale; bán một phần một issue (sale luôn copy toàn bộ lines của issue theo contract).
- Browser journey cho UI (như T03–T05, đóng ở T08/G07 nếu được yêu cầu riêng).

## Council — đã bác
- Nạp snapshot balance vào `line.quantity` (Contrarian): làm bẩn ngữ nghĩa cột dùng chung — cả 4 reviewer đều kết án; bộ ba sống trong event (First Principles thắng).
- Event stocktake chỉ chứa line có movement (Executor): line delta 0 sẽ biến mất khỏi hồ sơ — đúng chỗ bằng chứng kiểm kê cần nhất; event chứa MỌI line.
- Thêm cột snapshot/variance riêng trên line (Outsider): migration nặng cho một resource "tối thiểu", trùng dữ liệu event đã mang; read model đọc từ event là đủ ở v1.
- downstream.impact.v1 "có điều kiện" (Expansionist): text tự do không resolve thành partner; bịa nghĩa vụ relay của P09.
- Approval cho stocktake bằng ngưỡng tự chế: bịa quy tắc nghiệp vụ — đóng điều kiện của spec một cách minh bạch thay vì làm sân khấu.

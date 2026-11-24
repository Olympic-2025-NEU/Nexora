# P07-T05 — Receiving confirmation thực tế — KẾ HOẠCH (đã qua LLM Council)

Trạng thái: ĐÃ DUYỆT (Thịnh duyệt 2026-11-23). Sau khi Thịnh duyệt: OpenCode chạy trên nhánh mới `phase07/p07-t05-receiving-confirmation` từ `phase-07` (@ bc0d7e2). Milo kiểm chứng độc lập (gồm `npm run build`), merge `--no-ff` vào `phase-07`, giữ nhánh task, chờ CI.

## Nguồn sự thật
- `documents/phase-plan/phase-07-trading.md` mục P07-T05 + dòng AI handover (T05); `api-payloads-v1.md` dòng receivings; `event-payloads-v1.md` dòng `receipt.confirmed.v1` + quy tắc envelope; `event-contracts.md` (envelope v1).
- P07-T01 R3: hàng từ partner chỉ vào kho qua `receiving_confirmation`, không qua `goods_receipt` lần nữa.
- T02 schema: `trading.receiving_detail` (source_issuer_instance_id TEXT, source_transfer_id TEXT, inbound_message_id UUID, sent/actual totals, discrepancy_reason; UNIQUE thuần `(source_issuer_instance_id, source_transfer_id)`); `document_line` của receiving: `quantity`=sent, `actual_quantity`=actual, `source_line_ref` UUID = id line của transfer phía A (partial unique theo document); trigger guard bắt buộc actual_quantity + source_line_ref NOT NULL ngay khi insert; trigger deferred lúc confirm kiểm totals = SUM(lines) và reason khi chênh.
- `catalog.batch` có originIssuerInstanceId + originLotId **NOT NULL** (mọi batch luôn mang một origin nào đó; batch tự sản xuất có origin là chính nó) + sourcePartnerId.
- T03: pipeline runCommand + Idempotency-Key; `tradingUnitOfWork` (ReadCommitted, khóa dòng document FOR UPDATE, khóa balance theo thứ tự đã sắp); `adjustStock` với neo UNIQUE (source_line_id, kind); batch là master data của catalog — trading không tự tạo batch.
- T04: envelope federation + cơ chế giữ outbox (next_attempt_at=9999-12-31, pending, attempts 0 — dispatcher dead-letter ngay event federation chưa có consumer); messageId UUID sinh lúc confirm, lưu trong payload; own instance id = `NEXORA_ISSUER_INSTANCE_ID` ở composition; lỗi tham chiếu trong body → 422, chỉ {id} trên route mới 404.

## R0 — Bước 0 bắt buộc (đọc code trước, ghi vào evidence, không đoán)
1. Tên field scheduling trên `OutboxEventInput` (T04) và cách transfers.ts emit event bị giữ; cách T03 emit event nội bộ (destination traceability) qua registry ở composition/trading.ts.
2. Cách T03 xác định stock UOM của một variant (cho line receiving); movement kind T03 dùng cho nhập kho và neo (source_line_id, kind) — receiving dùng kind nào (kiểm inventory domain; line receiving là document riêng nên không đụng line goods_receipt).
3. API/service tạo batch của catalog: chữ ký, có nhận originIssuerInstanceId/originLotId/sourcePartnerId không; cách resolve variant → productId qua catalog repos.
4. Trigger T02 trên receiving: inventory đầy đủ các validation lúc confirm (đặc biệt actual ≤ quantity ở tầng DB có hay không) + tên constraint/raise code — bổ sung vào bảng rule-inventory nếu thiếu.
5. Envelope `receipt.confirmed.v1` trong event-contracts.md: danh sách field đầy đủ (schemaVersion, messageId, eventId, eventType, issuerInstanceId, recipientInstanceId, occurredAt, publishedAt, correlationId, causationId, sourceDocument, lots, upstreamReferences, evidence, sharingPolicyVersion + các field riêng của event theo event-payloads-v1.md).
6. Có bảng platform nào chứa được fixture store không; danh sách bảng exhaustive trong `tests/platform/schema.integration.mjs` (thêm bảng mới phải cập nhật).

## R1 — Nguồn message: port + fixture store được seed, KHÔNG đọc outbox của A
- Port trong trading: `resolveVerifiedAnnouncement(messageId)`, `listInboundAnnouncements()`, và service seed nội bộ `seedInboundAnnouncement(envelope)` (chỉ test/service nội bộ dùng — KHÔNG mở route public để seed hay tạo receiving thủ công ngoài API đã đóng băng).
- T05 implementation đọc từ **fixture store riêng** (bảng tối thiểu do migration T05 tạo — tên và schema theo bước 0, gợi ý `platform.inbound_message`: message_id PK, event_type, issuer_instance_id, recipient_instance_id, payload jsonb, payload_hash, received_at; cập nhật danh sách bảng trong schema test). Đây là "seeded inbox" của T05; P08/P09 thay implementation sau port, không đổi use case.
- Seed tính **JCS SHA-256** của envelope và lưu `payload_hash`; resolve tính lại và so — lệch → message không hợp lệ. Test chuỗi dùng chính envelope THẬT của T04 (lấy từ announcement đã confirm rồi seed vào store — mô phỏng transport một cách trung thực); sửa payload outbox sau khi seed KHÔNG ảnh hưởng message đã resolve (bằng chứng store độc lập).
- "Verified" ở T05 = đủ 5 kiểm: tồn tại; eventType = `transfer.announced.v1`; recipientInstanceId == `NEXORA_ISSUER_INSTANCE_ID` của mình; payload đúng shape contract (lots ≥ 1, quantity string > 0, sourceDocument.type = partner_transfer, sentQuantity == Σ lots); payload_hash khớp. Tính xác thực mật mã (chữ ký partner) thuộc P08/P09 — evidence và UI phải ghi nguồn là **seeded**, không gọi là đã xác thực chữ ký.
- Mọi dữ kiện của receiving (issuer, transfer id, sent từng line, product, origin lot, unit) lấy TỪ MESSAGE. Client chỉ khai: inboundMessageId, per-line localBatchId/warehouseId/actualQuantity/unit, discrepancyReason.

## R2 — Một receiving ĐANG HOẠT ĐỘNG cho mỗi (issuer, transfer) — mirror T04
- Migration mới: bỏ UNIQUE thuần `uq_trading_receiving_source`; thêm deferred constraint trigger (hàm + trigger trên receiving_detail VÀ trading.document — đúng pattern migration 20261123020000) từ chối ở commit receiving thứ hai có document status <> 'cancelled' cho cùng (source_issuer_instance_id, source_transfer_id). Bỏ `@unique` trong schema.prisma (drift discipline: constraint nâng cao chỉ sống trong migration SQL). Cập nhật schema battery T02 sang ngữ nghĩa mới.
- Receiving đã confirm = chiếm nguồn vĩnh viễn; draft bị cancel → tạo lại được. Vi phạm DB dịch thành typed **409 RECEIVING_ALREADY_EXISTS**; create use case kiểm trước sự tồn tại (đường thường) + khóa advisory theo (issuer, transfer) nếu pattern sẵn có cho phép — trigger là chốt cuối.

## R3 — Create sinh đủ line từ message; PATCH chỉ sửa phần B khai
- Create bắt buộc `actualLines` phủ đúng tập source line của message, mỗi line đúng một lần: thiếu → 422 SOURCE_LINE_MISSING; trùng → 422 SOURCE_LINE_DUPLICATE; lạ → 422 SOURCE_LINE_UNKNOWN. (Trigger guard bắt actual NOT NULL từ lúc insert — draft "thiếu line" là không thể lưu đúng; completeness ở confirm là chốt lại.)
- Server materialize lines: quantity := sent (từ message), actual_quantity := actual client khai, source_line_ref := id line transfer phía A, product/variant lấy từ lot của message, batch_id := localBatchId, warehouse_id := client, uom_id := stock UOM của variant phía B (client khai unit khác → 422; số lượng trong message đã là stock-UOM nên B không quy đổi).
- PATCH whitelist duy nhất: actualQuantity, localBatchId, warehouseId, discrepancyReason theo từng line + reason ở document. Thêm/bớt line, sửa sent/source_line_ref/product → 422.
- `actual <= sent` kiểm ở create, PATCH và confirm — vượt → **422 OVER_RECEIPT** (v1 không vào dispute state, không cộng phần vượt); actual < 0 → 422. discrepancyReason: bắt buộc ở CONFIRM khi tổng actual ≠ tổng sent → **422 DISCREPANCY_REASON_REQUIRED** (typed, trước trigger DB).

## R4 — Lot mapping: batch phía B phải là hiện thân của đúng lot phía A
- Mỗi line: batch tồn tại (không → 422 BATCH_NOT_FOUND); product của batch (qua variant) == productId của lot trong message (không → 422 BATCH_PRODUCT_MISMATCH); **(batch.originIssuerInstanceId, batch.originLotId) == (issuer của message, senderBatch.batchId của lot)** (không → 422 ORIGIN_MISMATCH). Không có nhánh "origin trống": cột NOT NULL — batch tự sản xuất có origin là chính nó nên tự động lệch với lot partner và bị từ chối đúng ý nghĩa (chống rửa nguồn).
- Nhiều source line → cùng một local batch: cho phép (cùng product + cùng origin lot theo các kiểm trên); confirm gom khóa balance theo (warehouse, batch) đã sắp thứ tự như T03, nhưng movement ghi THEO TỪNG LINE (neo source_line_id = line receiving).
- Tạo batch là việc của catalog, luôn luôn: test/demo tạo batch B qua catalog service với origin = lot của A trước khi receiving; receiving flow không tạo batch.

## R5 — Confirm: cộng theo ACTUAL, đúng 2 event, không ACK
- Thứ tự tx (tradingUnitOfWork): khóa dòng document FOR UPDATE → CAS draft→confirmed (0 dòng → 409) → kiểm lại scope kho hiện tại của actor trên mọi line → validate lại toàn bộ (message vẫn resolve được, actual ≤ sent từng line + tổng, reason khi chênh, mapping batch còn đúng) → set confirmed_by/at + totals trên receiving_detail → adjustStock cho từng line có actual > 0 (line actual = 0: KHÔNG movement) → emit ĐÚNG 2 outbox row trong cùng tx:
  1. `trading.receipt.confirmed.v1` nội bộ (destination traceability, pattern T03) — payload theo event-payloads (lines chỉ gồm line có movement? ghi rõ ở bước 0 theo contract: lines[] của event nội bộ mang quantity = actual của line được ghi nhận; line 0 không movement thì không có trong lines — chốt ở evidence).
  2. `receipt.confirmed.v1` federation — bị giữ pending bằng đúng cơ chế T04 (next_attempt_at xa, attempts 0).
- KHÔNG sinh technical ACK ở bất kỳ dạng nào; test khẳng định: sau confirm + một tick dispatcher, reply vẫn pending/attempts 0/payload nguyên vẹn, và không tồn tại artifact ACK.
- Replay Idempotency-Key → response đã lưu; confirm khóa mới trên document đã confirmed → 409. Cancel: draft → cancelled (giải phóng nguồn theo R2); confirmed không cancel được (ma trận T01).

## R6 — Envelope receipt.confirmed.v1
- issuerInstanceId = instance của mình (config); recipientInstanceId = issuerInstanceId CỦA MESSAGE (không tra bảng partner — message là nguồn quyền lực; partner có bị suspend sau đó cũng không phủ định một lô hàng thật). messageId = UUID mới sinh lúc confirm, lưu trong payload. correlationId = causationId = inboundMessageId; upstreamReferences chứa inboundMessageId; sourceDocument = {type: receiving_confirmation, id, version}.
- actualLines: MỌI source line đúng một lần, kể cả actual 0: {sourceLineId = line transfer phía A, receiverBatchId = batch phía B, sentQuantity, actualQuantity, unit} (số dạng string). lots: chỉ line actual > 0: {sourceLineId = line receiving LOCAL, quantity = actual, ...theo contract}. Totals: sentQuantity, actualQuantity, discrepancyQuantity = sent − actual, discrepancyReason khi có. Chỉ field trong contract — field lạ bị phía nhận từ chối ở v1.

## R7 — Phân loại lỗi (theo T01: 409 = xung đột trạng thái, 422 = vi phạm quy tắc)
- 422: SOURCE_MESSAGE_NOT_FOUND (messageId lạ), SOURCE_MESSAGE_INVALID (sai type/recipient/shape/hash), SOURCE_LINE_MISSING / SOURCE_LINE_DUPLICATE / SOURCE_LINE_UNKNOWN, OVER_RECEIPT, DISCREPANCY_REASON_REQUIRED, BATCH_NOT_FOUND, BATCH_PRODUCT_MISMATCH, ORIGIN_MISMATCH, unit lệch.
- 409: RECEIVING_ALREADY_EXISTS, transition không hợp lệ / version cũ (như T03/T04).
- 403: ngoài scope kho (create kiểm trên các warehouse khai; confirm kiểm lại scope HIỆN TẠI).
- 404 chỉ cho {id} của chính receivings. Policy: `trading:receiving:create|read|update|confirm|cancel` đăng ký ở platform/access/policy.ts cho mọi route.

## R8 — UI (app/trading/receivings/)
- List: document status + sent/actual/discrepancy + nguồn (issuer, transfer id).
- Create: chọn message từ DANH SÁCH seeded inbound (không gõ tay messageId); mỗi line: sent khóa hiển thị cạnh ô actual BẮT ĐẦU TRỐNG (buộc đếm thật; có nút "điền = sent" là hành động chủ động riêng, không phải mặc định), batch picker do server lọc theo product + origin khớp lot, warehouse picker; ô reason xuất hiện và thành bắt buộc khi có line lệch sent; tổng chênh lệch cập nhật trực tiếp.
- Detail/edit: breadcrumb chuỗi nguồn (issuer → transfer → message → receiving), bảng sent/actual/delta theo line, mapping lot → batch local, PATCH actual/mapping/reason khi draft, khối event sau confirm (nội bộ + reply bị giữ) và dòng chữ rõ ràng "business confirmation — technical ACK: none". Trang [id] có `export const instant = false` (bài học CI T04). Tái dùng shell/component của T03/T04.

## Commits (đúng thứ tự, mỗi commit tự xanh test+typecheck+lint; build ở commit UI)
1. `feat(p07-t05): one active receiving per source uniqueness` — migration bỏ unique thuần + deferred triggers; schema.prisma; schema battery cập nhật + test cancel→tạo lại, hai receiving active bị chặn.
2. `feat(p07-t05): seeded inbound announcement source` — fixture store (migration nếu cần theo bước 0) + port + seed service + kiểm verified 5 điểm + test: resolve đúng, sai recipient/type/hash → invalid, store độc lập với outbox.
3. `feat(p07-t05): create and edit receiving confirmations` — use case create (set-equality + materialize lines + mapping validations) + PATCH whitelist + cancel + routes + policies + unit/integration tests cho taxonomy R7.
4. `feat(p07-t05): confirm receiving posts actual stock and emits events` — confirm tx R5 + envelope R6 + battery tích hợp (mục Kiểm chứng).
5. `feat(p07-t05): trading receiving pages` — UI R8; `npm run build` phải pass.
6. `docs(p07-t05): evidence and phase checkboxes` — evidence trung thực (gồm: nguồn seeded — xác thực chữ ký để P08/P09; AC-06 hoàn chỉnh ở P09; checkbox UI chỉ tick khi code xong — ghi rõ chưa chạy browser journey nếu chưa chạy).

## Kiểm chứng (Milo chạy lại độc lập, không tin self-report)
- `npm test`, `npm run typecheck`, `npm run lint`, **`npm run build`** (bài học T04: task đụng app pages bắt buộc build).
- `npm run test:platform:schema` (migration + trigger mới + cancel/tạo lại).
- `npm run test:platform:trading` — battery T05 trên PG + Flowable thật, chạy TUẦN TỰ (không song song với schema — đã biếtชน runner):
  - Chuỗi G07 nửa sau: A receipt 20 → issue 12 (duyệt thật) → transfer confirm → seed envelope THẬT vào inbound store → tạo batch B qua catalog (origin = lot A) → receiving actual 10 + reason → confirm: tồn B +10 đúng batch B; tồn A không đổi; discrepancy 2 có reason; đúng 2 outbox row (nội bộ + reply bị giữ, envelope hợp schema, actualLines đủ mọi source line); ACK = 0.
  - Duplicate confirm (replay cùng key + confirm khóa mới) → vẫn +10, không thêm movement/event.
  - Line actual 0 → không movement cho line đó; confirm toàn 0 → 0 movement, lots=[] trong reply, vẫn bắt reason.
  - Over-receipt → 422 ở create; PATCH đẩy actual vượt sent → 422; thiếu/đủ reason theo chênh lệch.
  - Thiếu/trùng/lạ source line ở create → 422 đúng code; message sai recipient / sửa payload sau seed (hash lệch) → 422 SOURCE_MESSAGE_INVALID.
  - Hai create đồng thời cùng nguồn → một 409 RECEIVING_ALREADY_EXISTS; cancel draft → create lại thành công; receiving đã confirm → create mới 409 vĩnh viễn.
  - Batch sai product → 422; batch origin lệch (batch tự sản xuất của B) → 422 ORIGIN_MISMATCH.
  - Dispatcher tick sau confirm: reply vẫn pending, attempts 0, payload nguyên vẹn.

## Ngoài phạm vi (ghi rõ)
- Inbox/transport thật, chữ ký, technical ACK, delivery/retry của reply → P08/P09. AC-06 hoàn chỉnh ở P09; T05 chỉ chứng minh phía B local.
- Không sửa document phía A; trạng thái đối chiếu của sender cập nhật qua event ở P09.
- Dispute workflow cho over-receipt → sau v1 (v1: 422).
- GoodsReceipt cho cùng lô hàng: bị cấm bởi rule T01 R3 ở tầng quy trình — T05 không thêm cơ chế chặn liên document ngoài rule đó.

## Council — đã bác
- Đọc outbox của A làm nguồn resolve (Executor): phá vỡ biên instance — B không bao giờ đọc được outbox của A trong federation thật; trái lệnh "seeded fixture" của phase doc. Port giữ nguyên, implementation là fixture store.
- Giữ UNIQUE thuần one-shot (Expansionist): lặp lại đúng cái bẫy T04 vừa trả một migration để thoát; một draft cancel nhầm là đốt cháy lô hàng thật không cứu được.
- Draft để actual trống/mặc định sau (First Principles): không lưu được — trigger guard bắt actual NOT NULL từ lúc insert; completeness theo A/Executor thắng.
- Prefill actual = sent + cử chỉ "đã đếm" (Outsider): mời đóng dấu thay vì đếm; chỉ nhận tính trung thực của Outsider — gọi nguồn là "seeded" ở UI/evidence. Tạo batch ngay trong receiving flow (Outsider) cũng bị bác: batch thuộc catalog.
- Origin "trống thì cho qua" (Executor): cột origin NOT NULL nên nhánh này chết — rule rút gọn thành origin phải KHỚP, và đó là chốt chống rửa nguồn.

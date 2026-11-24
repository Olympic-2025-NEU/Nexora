# P07-T04 PLAN — Partner transfer và liên kết issue (Phase 07 · M03 Trading & Distribution)

- **Task:** P07-T04 theo `documents/phase-plan/phase-07-trading.md` + hàng T04 trong "Hồ sơ giao AI"
- **Nhánh:** task branch `phase07/p07-t04-partner-transfer` tách từ `phase-07` (2aaf8ac)
- **Người duyệt plan:** Thịnh · **Người code:** OpenCode · **Người kiểm chứng:** Milo (tự chạy lại integration trên PG thật + test/typecheck/lint, đọc tay luồng confirm)
- **Trạng thái:** ĐÃ DUYỆT 2026-11-23 — Thịnh approved.
- **Hội đồng:** LLM Council 5 cố vấn + 6 phản biện chéo (23/11/2026). Phản biện nhất trí: bản của Executor là khung duy nhất xây được đúng schema thật; ba lỗ hổng cả 5 cố vấn cùng bỏ sót (phân quyền/scope, race lúc tạo, partner không có địa chỉ federation) đã được chairman bổ vào plan.

---

## 1. Bối cảnh — cái đã có, không làm lại

- **T01:** transfer chỉ liên kết issue có `issue_purpose='partner_transfer'`; trạng thái chứng từ transfer draft→confirmed trực tiếp (không qua Flowable); correction không cascade.
- **T02:** `trading.transfer_detail` — `linked_issue_id` **UNIQUE thuần**, `destination_partner_id` FK → `system.partner(id)`, `delivery_state` ∈ {pending, technical_ack, awaiting_receipt, received, partial, disputed} mặc định `pending`, `technical_ack_at`, `business_receipt_at`. Deferred trigger đã validate khi confirm: line của transfer phải khớp line của issue liên kết, totals = SUM(lines). Line có `source_line_ref` trỏ về line gốc.
- **T03:** use case + route + UI cho receipt/issue; `tradingUnitOfWork` (ReadCommitted, khoá row chứng từ FOR UPDATE); pipeline `runCommand` (Idempotency-Key: replay trả response đã lưu trước mọi guard; lệnh fail không giữ key; cùng key khác payload → 409). Line của issue đã được chuẩn hoá về stock UOM tại submit — **T04 không quy đổi gì thêm**. App role không có quyền DELETE trên `trading.document`.
- **API contract đã chốt** (`api-payloads-v1.md` dòng 68): `POST/GET /api/v1/transfers`, `GET /api/v1/transfers/{id}`, `POST /{id}/confirm|cancel`; body tạo = `{linkedIssueId, destinationPartnerId, note?}`; **server tự copy lines từ issue**; exact 1:1; một issue chỉ một transfer; confirm tạo outbox `transfer.announced.v1`, **không** movement. Không có PATCH cho transfer.
- **Envelope v1 đã chốt** (`event-contracts.md` + `event-payloads-v1.md`): schemaVersion, messageId, eventId, eventType, issuerInstanceId, recipientInstanceId, occurredAt, publishedAt, correlationId, causationId, sourceDocument{type,id,version}, lots[]{sourceLineId (line của TRANSFER), originLot{issuerInstanceId, lotId}, senderBatch{instanceId, batchId}, product{instanceId, productId}, quantity (string), unit}, upstreamReferences[], evidence[], sharingPolicyVersion, linkedIssueId, sentQuantity (string). Mọi decimal là string; hash payload = JCS SHA-256; receiver reject field lạ; sender giữ nguyên envelope/messageId cho mọi lần retry.
- **Partner (M01):** `system.partner` — id, `issuerInstanceId` (string, unique), code, displayName, `status` mặc định 'active', quan hệ PartnerConnection.
- **Chưa hề có:** module federation (phần nhận/ACK là P08/P09), và **không code nào biết instance ID của chính mình** — T04 phải bổ sung.

## 2. Mục tiêu và phạm vi

**Mục tiêu:** transfer chạy thật ở phía gửi — tạo từ một issue đã confirmed (copy line nguyên trạng), confirm phát đúng **một** envelope `transfer.announced.v1` vào outbox trong cùng transaction, **không** trừ tồn lần hai, và trạng thái gửi (pending/retry) nhìn thấy được từ API/UI kể cả khi phía B không tồn tại/offline.

**Trong phạm vi:**
1. **Bước 0 — kiểm chứng hợp đồng outbox/federation** (mục 3, R0) trước khi viết code.
2. Migration nới lỏng ràng buộc 1-transfer-mỗi-issue thành **1 transfer chưa-huỷ mỗi issue** (R1).
3. Use case transfer: create (copy lines) / get / list / confirm / cancel — qua `runCommand`, policy `trading:transfer:*`, kiểm scope kho theo pattern T03.
4. Envelope builder theo contract + cấu hình instance ID của chính mình (R3); confirm phát event đúng một lần (R7).
5. Read model `announcement` từ outbox row (R4) + routes `/api/v1/transfers`.
6. UI transfers trong `app/trading/` (R8).
7. Integration tests trên PG thật (mục 6) + evidence + tick checkbox T04 theo đúng mức đã kiểm chứng.

**Ngoài phạm vi:** receiving confirmation (T05), mọi endpoint/chuyển trạng thái ACK và delivery_state beyond `pending` (P08/P09), viết lại dispatcher (chỉ "giữ pending" nếu bước 0 chứng minh nguy cơ dead-letter — R5), transfer từng phần (v1 là all-or-nothing theo issue), PATCH transfer, recall transfer đã confirm (giới hạn đã biết — mục 7).

## 3. Các chốt thiết kế (chairman rulings)

**R0 — Bước 0 bắt buộc (phản biện chỉ ra: mọi phương án ID/hash đều có thể va chạm thực tế pipeline):** đọc code thật, ghi vào evidence trước khi code:
(a) `platform/outbox` — `OutboxEventInput` có field gì; pipeline gán event/message ID thế nào; outbox row có cột payload/hash/metadata không; **dispatcher xử lý event không có consumer đăng ký ra sao** (retry theo backoff? dead-letter ngay? bỏ qua?) — kết quả quyết định thiết kế test R5 và việc có phải gate federation event ở trạng thái chưa-dispatch-được hay không.
(b) `event-payloads-v1.md` — danh sách field đầy đủ của riêng `transfer.announced.v1` (ngoài ví dụ envelope chung).
(c) Cách T03 emit event + đăng ký policy `trading:*` + pattern route/action route hiện có.
(d) Đường đọc `system.partner` + field của PartnerConnection (có endpoint của phía B không — chỉ để biết, T04 không gọi).
(e) Pattern đọc cấu hình server-only hiện có (composition roots / platform config) để đặt instance ID cho đúng chỗ.

**R1 — Một transfer CHƯA HUỶ cho mỗi issue (toàn hội đồng thống nhất; cơ chế của Executor vì cơ chế "partial index" của số đông là không viết được):** `status` nằm trên `trading.document`, không nằm trên `transfer_detail`, nên partial unique index theo status là bất khả thi. Cơ chế chốt: migration mới **bỏ UNIQUE thuần** `uq_trading_transfer_issue`; thêm **deferred constraint trigger** (đúng kiến trúc trigger của T02, tên/raising code theo quy ước `trading_*`) chặn tại commit khi tồn tại transfer_detail khác cho cùng issue mà chứng từ của nó có status ≠ 'cancelled'; đồng thời use case create **khoá row của issue (FOR UPDATE)** trước khi kiểm + insert để serialize các create song song cho cùng issue. Cancel giữ nguyên detail row + source IDs làm lịch sử; issue được giải phóng ngay khi transfer huỷ. Transfer đã **confirmed thì chiếm issue vĩnh viễn**. Vi phạm trigger ở DB phải dịch thành typed 409 `TRANSFER_ALREADY_EXISTS`, không rò lỗi thô. Cập nhật `schema.prisma` khớp migration; các ràng buộc nâng cao chỉ sống trong migration SQL (kỷ luật drift của T02 R10). Test schema phải cập nhật: đòn tấn công "hai transfer active cho một issue" vẫn bị chặn (bằng trigger thay vì unique), "tạo → huỷ → tạo lại" phải ĐƯỢC.

**R2 — Copy line tại create, đối chiếu exact tại confirm; correction không chặn, không cascade.** Copy các field: lineNo, warehouseId, productVariantId, productId (denormalized), batchId, quantity, uomId, và `source_line_ref` = id của line issue gốc. Không quy đổi UOM (line issue đã ở stock UOM). Tại confirm: nạp lại cả hai tập line dưới khoá, đòi khớp exact theo từng source line (số lượng line + Decimal equality trên batch/variant/product/warehouse/quantity/uom); lệch → 409 `TRANSFER_LINE_MISMATCH`; trigger T02 là sàn backstop. Correction của issue tạo issue MỚI — transfer vẫn trỏ issue gốc (snapshot là bản ghi đã gửi); **không** áp dụng gợi ý "chặn transfer khi issue đã bị supersede" của thiểu số: issue gốc vẫn confirmed và còn hiệu lực, T01 đã chốt correction không cascade; ghi rõ quyết định này vào evidence. Correction xảy ra sau khi transfer confirmed cũng không ảnh hưởng transfer.

**R3 — Instance ID của mình là cấu hình deploy; envelope dựng tại confirm, chỉ field của contract.** Bổ sung cấu hình server-only `NEXORA_ISSUER_INSTANCE_ID` đọc tại composition root của trading, **validate ngay khi dựng composition** (thiếu → lỗi cấu hình rõ ràng, không đợi tới confirm). Không dùng Keycloak issuer (đó là danh tính xác thực), không dùng organization/tenant id (đó là scope nghiệp vụ) — toàn hội đồng thống nhất. `recipientInstanceId` = `partner.issuerInstanceId` **đọc tươi tại confirm**. Hai chốt do phản biện bổ sung: partner có `issuerInstanceId` rỗng → chặn ngay tại create bằng 422 `PARTNER_NOT_FEDERATED` (partner thuần local không nhận được envelope); recipient trùng instance ID của mình → 422 (không tự chuyển cho mình). Envelope chỉ gồm field của contract (field lạ bị receiver reject): lots dựng từ line đã copy của transfer (sourceLineId = id line của TRANSFER; originLot/senderBatch/product mang instanceId của mình; lotId/batchId = batchId của line; productId = productId của line; quantity = string của quantity; unit = mã stock UOM). `messageId`: phải ổn định qua mọi retry và duy nhất theo transfer — dùng cơ chế bước 0 xác nhận là khả thi với pipeline (id của outbox row nếu emit API cho biết, hoặc UUID sinh trong transaction confirm và lưu trong payload; retry luôn dùng lại payload bytes đã lưu nên tính ổn định giữ nguyên). **JCS SHA-256** tính trên envelope hoàn chỉnh tại confirm; lưu kèm payload **nếu** outbox row có slot hash/metadata (bước 0 quyết định); nếu không có slot, test tự tính lại hash từ payload đã lưu để đối chiếu và ghi "lưu hash" là việc của P09 — không tự chế cột ngoài thiết kế outbox.

**R4 — delivery_state chỉ tới `pending` trong T04; trạng thái gửi đọc từ outbox, không nhân bản.** T04 không tạo chuyển trạng thái nào khác, không giả lập ACK. `GET /transfers/{id}` trả thêm block `announcement` — {messageId, status, attempts, nextAttemptAt, lastError} — truy vấn riêng tới outbox row `transfer.announced.v1` của chứng từ đó; không chép counter retry lên `transfer_detail`. UI hiển thị cả 6 delivery_state dạng read-only, các state chưa tới được ghi rõ "chờ federation (Phase 08/09)".

**R5 — Test "B offline" chứng minh decoupling ở phía A + hành vi dispatcher thật, không đóng kịch liên thông.** Chuỗi: receipt 20 → issue 12 (balance 8) → confirm transfer 12. Assert: đúng **một** outbox row với envelope đã đóng băng (recipient đúng, sentQuantity "12", lots khớp line); transfer confirmed, delivery_state = pending; **0 movement** phát sinh từ transfer; balance vẫn 8; lịch sử local đọc được. Sau đó chạy dispatcher theo ngữ nghĩa thật đã đọc ở bước 0: nếu nó retry event chưa có handler → assert attempts tăng, backoff được đặt, không dead-letter trước khi cạn policy, không sinh row thứ hai, trạng thái A không đổi. Nếu nó dead-letter ngay → T04 phải **giữ federation event ở trạng thái chưa-dispatch-được cho tới P09** bằng cơ chế dispatcher sẵn có hỗ trợ (ghi rõ vào evidence) — mất envelope duy nhất là kết quả không chấp nhận được. Evidence nói thẳng: delivery/ACK/interop là P08/P09, T04 không tuyên bố.

**R6 — Phân quyền + taxonomy lỗi (bổ sung hai lỗ hổng phản biện bắt được: scope và race lúc tạo).** Mọi route qua policy `trading:transfer:create|confirm|cancel|read`. Create: kiểm scope của actor trên các warehouse của issue. **Confirm: kiểm lại scope hiện tại** của actor trên các warehouse đó (đúng pattern cổng confirm của T03). Bảng lỗi typed: partner không tồn tại → 422 `PARTNER_NOT_FOUND`; partner inactive tại create → 422 `PARTNER_INACTIVE`; partner chưa federation (issuerInstanceId rỗng) → 422 `PARTNER_NOT_FEDERATED`; tự chuyển cho mình → 422; issue không tồn tại → 422 `ISSUE_NOT_FOUND`; sai purpose → 422 `ISSUE_WRONG_PURPOSE`; issue chưa confirmed → 409 `ISSUE_NOT_CONFIRMED`; đã có transfer active → 409 `TRANSFER_ALREADY_EXISTS`; **partner bị deactivate giữa create và confirm → 409 `PARTNER_INACTIVE`** (thế giới thay đổi dưới chân — đa số hội đồng; thiểu số đề xuất 422, không theo); line lệch tại confirm → 409 `TRANSFER_LINE_MISMATCH`; transition không hợp lệ / stale version → 409.

**R7 — Confirm: một transaction, một envelope, 0 movement theo cấu trúc.** Trong `tradingUnitOfWork`/`runCommand`: khoá row transfer FOR UPDATE → khoá row issue → CAS draft→confirmed theo id+version (0 row → 409) → nạp tươi partner (active + federated + không phải mình), issue (vẫn confirmed), hai tập line (equality R2) → kiểm scope actor (R6) → set confirmed_by/at → `ctx.emit` đúng một envelope → commit. Use case confirm của transfer **không import inventory port** (0 movement theo cấu trúc, không theo lời hứa) và test assert movement count + balance không đổi. Replay cùng Idempotency-Key trả response đã lưu (không emit lần hai); confirm lại bằng key mới trên transfer đã confirmed → guard 409. Create cũng khoá row issue trước kiểm-tra-đã-transfer + insert (R1).

**R8 — UI: trang transfers riêng, mỏng, dùng lại shell của T03.** Trong `app/trading/`: list (document status + chip delivery_state), create (issue picker **lọc phía server**: confirmed + purpose partner_transfer + chưa có transfer active; partner picker chỉ active + đã federation; lines copy hiển thị read-only), detail (lines đã copy; delivery_state; block announcement: messageId, outbox status/attempts/next retry/last error; source IDs: transfer id + document number, linked issue id + number, destination partner id + issuerInstanceId). Không editor, không nút ACK/retry giả.

## 4. File plan

| File | Việc |
| --- | --- |
| `prisma/migrations/<timestamp>_transfer_active_link/` | MỚI. Bỏ UNIQUE thuần trên linked_issue_id + deferred trigger "một transfer chưa huỷ mỗi issue" + grants giữ nguyên. |
| `prisma/schema.prisma` | Bỏ `@unique` trên linkedIssueId của TransferDetail (khớp migration; ràng buộc thật sống trong SQL). |
| `tests/platform/schema.integration.mjs` (+ battery T02 liên quan) | Cập nhật: tấn công hai-transfer-active vẫn bị chặn bởi trigger; cancel-then-recreate được phép; restore drill vẫn pass. |
| `contexts/trading/application/transfers.ts` | MỚI. Use case create (copy lines, khoá issue)/get/list/confirm (R7)/cancel cho partner_transfer; envelope builder có thể tách file riêng `announcement.ts`. |
| `contexts/trading/application/http.ts` | Mở rộng: parse/map lỗi typed cho transfers theo bảng R6. |
| `contexts/trading/index.ts`, `composition/trading.ts` | Export + wiring; đọc/validate `NEXORA_ISSUER_INSTANCE_ID` tại composition. |
| `app/api/v1/transfers/route.ts`, `app/api/v1/transfers/[id]/route.ts`, `app/api/v1/transfers/[id]/[action]/route.ts` | MỚI theo pattern route của T03. Policy `trading:transfer:*` đăng ký ở platform/access nếu chưa có. |
| `app/trading/transfers/...` | MỚI. List + create + detail theo R8, dùng lại component read-only của T03. |
| `tests/platform/trading-documents.integration.test.ts` (mở rộng) hoặc file riêng của T04 theo pattern harness | Chuỗi A8, one-active-transfer, cancel frees issue, create race, replay/duplicate confirm, B-offline theo R5, taxonomy lỗi. |
| `documents/phase-plan/evidence/p07-t04.md` | MỚI. Kết quả bước 0 + lệnh/kết quả thật + phần chưa làm thuộc T05/P08/P09 + giới hạn đã biết (mục 7). |
| `documents/phase-plan/evidence/source-inventory.json` | Refresh nếu thêm file nguồn. |
| `documents/phase-plan/phase-07-trading.md` | Tick checkbox T04 theo đúng mức đã kiểm chứng. |

## 5. Commit plan (logical, theo thứ tự)

1. `feat(p07-t04): one active transfer per issue uniqueness` — migration bỏ UNIQUE thuần + deferred trigger + đồng bộ schema.prisma + test schema/trigger.
2. `feat(p07-t04): create and cancel partner transfers` — copy lines, khoá issue, validations + typed errors R6; integration: luật tạo + huỷ-giải-phóng-issue + tạo lại.
3. `feat(p07-t04): confirm transfer announces federation event` — cấu hình instance ID, envelope builder, transaction confirm R7, read model announcement.
4. `test(p07-t04): announcement, offline dispatcher and replay battery` — B-offline theo R5, replay/duplicate-confirm, race hai create, 0-movement.
5. `feat(p07-t04): trading transfer pages` — UI theo R8.
6. `docs(p07-t04): evidence and phase checkboxes` — evidence trung thực + tick checkbox.

Merge: Milo kiểm chứng xanh → merge `--no-ff` vào `phase-07`, push cả hai nhánh, giữ task branch. OpenCode KHÔNG tự merge, KHÔNG push.

## 6. Kiểm chứng (Milo tự chạy lại, trên PG thật qua harness dùng-một-lần)

- **Chuỗi chuẩn:** receipt 20 → issue 12 approved+confirmed (balance 8) → tạo transfer (lines copy exact) → confirm → balance **vẫn 8**; movement count không tăng; đúng 1 outbox row `transfer.announced.v1`; envelope đúng contract (recipient = partner.issuerInstanceId, linkedIssueId đúng, sentQuantity "12", lots khớp từng line của transfer, decimal dạng string); delivery_state = pending; announcement read model khớp outbox row.
- **One-active-transfer:** tạo transfer thứ hai cho cùng issue (key mới) → 409 `TRANSFER_ALREADY_EXISTS`; **hai create chạy đồng thời** cho cùng issue → đúng một thành công; draft không phát event nào (0 outbox row trước confirm).
- **Cancel giải phóng:** tạo → cancel → tạo lại cùng issue → thành công; transfer đã confirmed thì tạo lại → 409 vĩnh viễn.
- **Replay/duplicate:** confirm replay cùng key → response gốc, vẫn 1 outbox row; confirm lại bằng key mới → 409.
- **B-offline (R5):** chạy dispatcher theo ngữ nghĩa thật — envelope không mất, không sinh row thứ hai, trạng thái A nguyên vẹn; hành vi cụ thể assert theo kết quả bước 0 và ghi rõ vào evidence.
- **Taxonomy:** từng dòng của bảng R6 có ít nhất một test khẳng định typed error + HTTP code (partner inactive/not-federated/self, issue unconfirmed/wrong-purpose, partner deactivate trước confirm, line mismatch do sửa dữ liệu trực tiếp dưới migrator).
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:platform:schema`, `npm run test:platform:trading` xanh; Milo đọc tay luồng confirm đối chiếu thứ tự R7.

## 7. Rủi ro hội đồng đã bắt và cách plan xử lý

- **UNIQUE thuần khoá chết issue sau một draft huỷ** (toàn hội đồng + phản biện): R1 đổi sang "một transfer chưa huỷ" bằng deferred trigger + khoá row issue — partial index theo status là không viết được vì status nằm ở bảng document (phản biện chỉ ra).
- **Mọi phương án messageId/hash có thể va chạm pipeline thật:** R0 đọc outbox contract trước; R3 chỉ dùng cơ chế pipeline sẵn có hỗ trợ, không tự chế cột.
- **Envelope gửi tới hư không:** partner thiếu issuerInstanceId hoặc trùng chính mình — phản biện bắt cả hội đồng bỏ sót; R3/R6 chặn tại create (422) và kiểm lại tại confirm.
- **Thiếu phân quyền:** cả 5 cố vấn đều quên scope — R6 bắt policy mọi route + kiểm lại scope kho tại confirm như T03.
- **Race hai create:** picker không đủ — R1/R7 khoá row issue ngay trong create.
- **"B offline" là tuyên bố rỗng nếu test sai:** R5 chỉ tuyên bố decoupling phía A + hành vi dispatcher thật; nếu dispatcher dead-letter ngay thì phải giữ event pending tới P09, tuyệt đối không mất envelope.
- **Giới hạn đã biết, ghi nhận không giải quyết ở T04:** transfer đã confirmed mà không bao giờ gửi được sẽ chiếm issue vĩnh viễn, delivery_state kẹt ở pending cho tới P08/P09 (T01 không có transition confirmed→cancelled cho transfer; recall flow là việc của phase federation).

## 8. Lệnh cho OpenCode

- Làm việc **chỉ** trong `~/nexora-clean-check`, nhánh `phase07/p07-t04-partner-transfer`. Không đọc/ghi ngoài thư mục dự án, không đọc `deploy/instances/*.env`. Tool bị từ chối quyền: bỏ qua, làm tiếp.
- Làm **bước 0 (R0) trước**, ghi kết quả vào evidence; nếu sự thật khác giả định của plan ở điểm làm thay đổi thiết kế, dừng phần liên quan và ghi rõ vào evidence thay vì tự chế cơ chế mới — đặc biệt là hành vi dispatcher với event chưa có consumer (R5).
- Không sửa các file plan untracked ở gốc repo. Không thêm dependency. File nguồn mới có header SPDX 1 dòng. Comment tối thiểu hoặc không.
- Test integration chạy trên harness Postgres dùng-một-lần có sẵn; việc Docker/PG/Flowable nào không chạy được trong môi trường OpenCode thì ghi rõ vào evidence là chưa chạy — KHÔNG bịa kết quả, KHÔNG tick checkbox chưa kiểm chứng.
- Theo thứ tự commit mục 5; xong việc viết evidence trung thực, KHÔNG tự merge, KHÔNG push.

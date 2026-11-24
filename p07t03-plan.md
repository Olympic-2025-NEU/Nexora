# P07-T03 PLAN — Goods receipt và issue end-to-end (Phase 07 · M03 Trading & Distribution)

- **Task:** P07-T03 theo `documents/phase-plan/phase-07-trading.md` + hàng T03 trong "Hồ sơ giao AI"
- **Nhánh:** task branch `phase07/p07-t03-receipt-issue` tách từ `phase-07` (31d4af8)
- **Người duyệt plan:** Thịnh · **Người code:** OpenCode · **Người kiểm chứng:** Milo (tự chạy lại integration trên PG thật + test/typecheck/lint, đọc tay luồng confirm)
- **Trạng thái:** ĐÃ DUYỆT 2026-11-23 — Thịnh approved.
- **Hội đồng:** LLM Council 5 cố vấn + 5 phản biện chéo (23/11/2026). Đồng thuận cao; các điểm tranh cãi và các lỗ hổng cả hội đồng cùng bỏ sót đã được chairman chốt ở mục 3 bằng sự thật của repo (schema T02, hash của bridge P04, taxonomy lỗi T01).

---

## 1. Bối cảnh — cái đã có, không làm lại

- **T01:** contract transition đã đóng băng — receipt draft→confirmed trực tiếp (+quantity/line); issue draft→submit→pending_approval→approved→confirm→confirmed (−quantity), `issue_purpose` cố định từ lúc tạo. Correction là chứng từ mới cùng loại, không tự đảo ngược gốc.
- **T02:** schema `trading.*` + deferred trigger chặn confirm thiếu/sai cấu trúc + trigger bất biến confirmed + repository nhận tx của người gọi. Mỗi line lưu **một** quantity + `uom_id` (giá trị người nhập).
- **P04:** command pipeline `runCommand` (transaction + Idempotency-Key + audit + `ctx.emit` outbox); approval bridge trên `platform.approval_request` — submit tạo request + decision-intent outbox, worker khởi động Flowable `goods-issue-approval`, decision ghi intent trước rồi đồng bộ engine; bridge tự tính `line_snapshot_sha256` từ **các field đã lưu của line** `{lineNo, warehouseId, productId, batchId, quantity, unit}`; confirm đòi bridge state = approved + hash khớp + scope hiện tại của actor; cấm tự duyệt.
- **Inventory port (P06):** `adjustStock(tx, input)` — delta theo **stock UOM của variant**, neo idempotency UNIQUE `(source_line_id, kind)`, balance không âm ở tầng DB; `findBalancesOrdered`, `openStockBalance` cùng được export.
- **API contract đã chốt** (`api-payloads-v1.md` dòng 66–67): `/api/v1/receipts` và `/api/v1/issues` với các action confirm/cancel (receipt) và submit/confirm/cancel (issue); PATCH/confirm dùng If-Match; taxonomy lỗi T01: state conflict → 409, vi phạm quy tắc nghiệp vụ → 422.
- **Batch là master data của catalog (P06)** — đã có API `/api/v1/batches`; chứng từ chỉ tham chiếu batch có sẵn.
- Route mẫu: `app/api/v1/batches/route.ts` (resolveUserActor → checkPolicy → runCommand → http helpers của context); composition root ở `composition/`; UI ở `apps/dx-lab`, trading UI dưới `/trading/*` (ADR 0016).

## 2. Mục tiêu và phạm vi

**Mục tiêu:** hai luồng chứng từ đầu tiên chạy thật end-to-end — nhập kho tăng tồn, xuất kho (qua duyệt thật) giảm tồn — với transaction nguyên tử (status + movement + balance + audit + outbox), chống double-post ở ba lớp, và bằng chứng AC-03/AC-04 trên PostgreSQL thật.

**Trong phạm vi:**
1. **Bước 0 — kiểm chứng các giả định về port/pipeline/bridge** (mục 3, R0) trước khi viết code.
2. Use case trading: create/edit/get/list + confirm/cancel cho receipt; create/edit/get/list + submit/confirm/cancel cho issue — qua `runCommand`, repository T02, `adjustStock`.
3. Nối approval bridge thật cho issue (submit + cổng confirm); cancel issue đã submit phải huỷ approval request qua bridge.
4. HTTP routes `/api/v1/receipts`, `/api/v1/issues` theo mẫu route sẵn có + policy `trading:receipt:*` / `trading:issue:*` (đăng ký policy nếu chưa có).
5. UI tối thiểu trong dx-lab: list + form cho hai loại, batch picker, balance trước/sau, hiển thị lỗi theo type.
6. Integration tests trên PG thật: AC-03/AC-04, race hai issue, rollback, idempotency, stale version. Evidence + tick checkbox T03.

**Ngoài phạm vi:** approver inbox + decision endpoint/UI (T07), engine failure/late-result (T07), failure-injection suite tổng quát + history query (T08), transfer/receiving/stocktake/sale (T04–T06), tạo batch trong luồng receipt (batch tạo ở catalog), UI journey hoàn chỉnh (P11). **Không sửa internals của bridge, pipeline, inventory** — thiếu accessor thì thêm ở module sở hữu, không workaround trong trading.

## 3. Các chốt thiết kế (chairman rulings)

**R0 — Bước 0 bắt buộc (cả hội đồng đều giả định, không ai kiểm chứng):** đọc code thật và ghi kết quả vào evidence trước khi code:
(a) `adjustStock` / `findBalancesOrdered` / `openStockBalance` — có khoá row (`FOR UPDATE`) không? balance chưa có row thì sao (upsert hay phải open trước)? lỗi thiếu tồn là typed error hay constraint thô?
(b) `runCommand` — idempotency lưu gì, replay trả gì, **lệnh fail có bị lưu dưới key không**, cùng key khác payload thì sao?
(c) Bridge — API gọi submit/decision ở service level (mẫu test workflow P04 lái decision trong process thế nào), một document có tạo được 2 approval_request không?
(d) Nguồn hệ số quy đổi UOM chính thức trong catalog P06.5 (variant_uoms hay packings) + field expiry/quality trên batch.
Kết quả bước 0 quyết định các chốt R3/R5 ghi "theo hợp đồng đã kiểm chứng" — nếu sự thật khác giả định, dừng và báo lại thay vì tự chế.

**R1 — Approval: T03 nối thật, T07 làm trải nghiệm.** Submit của issue gọi bridge thật (tạo `approval_request` + intent outbox, draft→pending_approval). Confirm kiểm đủ ba điều kiện P04: bridge state = approved, hash hiện tại = snapshot hash, scope hiện tại của actor. **Cấm tuyệt đối** seed thẳng state approved trong test — decision phải đi qua đường decision thật của bridge (trong process theo mẫu test P04, poll trạng thái có timeout, không sleep cố định). Map lỗi confirm theo state bridge: chưa approved → 409 `APPROVAL_NOT_YET_APPROVED`; rejected → 409 `APPROVAL_REJECTED`; cancelled/halted/không có request → 409; hash lệch → 409 `APPROVAL_LINE_MISMATCH`; tự duyệt → 403 theo bridge. Cancel issue ở trạng thái pending_approval/approved phải đồng thời cancel approval request qua bridge (không để request mồ côi).

**R2 — Quy đổi UOM: chuẩn hoá tại điểm không-quay-lại, một invariant duy nhất.** Line lưu giá trị người nhập khi còn draft (create/edit + preview quy đổi chỉ để hiển thị). Tại **submit (issue)** và **confirm (receipt)**, use case **ghi lại line về stock UOM** (quantity := giá trị đã quy đổi, uom_id := stock UOM) **trong cùng transaction, trước** khi bridge snapshot (issue) / trước khi ghi movement (receipt). Từ điểm đó line đóng băng (issue: PATCH chỉ ở draft; receipt: confirmed bất biến). Invariant: **mọi line đã được duyệt hoặc đã ghi tồn đều lưu bằng stock UOM — stored = approved = posted.** Hệ quả: hash của bridge phủ đúng số sẽ post; trigger deferred validate đúng biểu diễn sẽ post; trôi hệ số quy đổi sau submit không ảnh hưởng issue (receipt nhận hệ số tại thời điểm confirm — không có approval cần bảo vệ, và response confirm là số chính thức). Hàm quy đổi là **một** hàm duy nhất, idempotent theo cấu trúc (line đã ở stock UOM quy đổi thành chính nó) nên replay không nhân đôi. Số học Decimal từ đầu đến cuối, làm tròn **một lần** HALF_UP 3 chữ số thập phân; quy đổi ra 0.000 → 422 `CONVERSION_ROUNDS_TO_ZERO`. Đánh đổi có chủ đích, ghi vào evidence: số lượng đóng gói người dùng đã nhập không còn lưu sau submit/confirm (khi draft, cả hai dạng đều hiển thị ở response/UI).

**R3 — Race: khoá theo thứ tự xác định + gộp nhu cầu theo batch.** Trong transaction confirm: (1) khoá/guard chứng từ (CAS theo status + version — update có điều kiện, 0 row → 409); (2) gộp tổng nhu cầu theo từng (warehouse, batch) trên **toàn bộ line** (hai line cùng batch không được tự kiểm riêng lẻ); (3) khoá các balance row theo thứ tự đã sắp xếp toàn cục (theo hợp đồng khoá đã kiểm chứng ở R0 — nếu `findBalancesOrdered` không khoá thì use case tự `SELECT … FOR UPDATE` theo đúng thứ tự đó; không nâng isolation lên Serializable); (4) kiểm đủ tồn trên số đã gộp, dưới khoá; (5) `adjustStock` từng line; (6) cập nhật status/version + audit + outbox. Balance chưa có row = tồn 0 đối với issue (→ 422 nếu cần xuất); receipt tạo row qua cơ chế của port đã kiểm chứng ở R0. Người thua race nhận **422 `INSUFFICIENT_STOCK`** kèm `{batchId, requested, available}` (taxonomy T01: 409 chỉ cho xung đột trạng thái/version/approval). Mọi lỗi DB backstop (balance âm 23514, unique movement) phải được dịch sang typed error tương ứng — không rò lỗi thô ra API.

**R4 — Ba lớp chống double-post, kiểm riêng từng lớp.** (1) Idempotency-Key qua `runCommand`: replay cùng key trả kết quả gốc, không post lại — thứ tự kiểm tra replay **trước** kiểm tra version (theo ngữ nghĩa pipeline đã kiểm chứng ở R0; nếu pipeline lưu cả kết quả fail thì test phải chốt hành vi retry-cùng-key-sau-fail theo đúng ngữ nghĩa đó và ghi vào evidence). (2) Transition guard: confirm lần hai bằng key mới trên chứng từ đã confirmed → 409. (3) UNIQUE `(source_line_id, kind)` ở movement: lớp vật lý cuối. Test phải phủ cả ba lớp tách biệt.

**R5 — Validation phân tầng: draft cấm sai, không cấm thiếu; confirm là bức tường.** Create/edit: policy mọi endpoint; tham chiếu tồn tại và đúng quan hệ (batch thuộc variant, warehouse/variant/batch có thật); quantity > 0, tối đa 3 chữ số thập phân; uomId thuộc variant_uoms và quy đổi được; purpose bắt buộc lúc tạo issue và PATCH không đổi được; correction link (nếu có) trỏ chứng từ cùng loại, đã confirmed → sai thì 422. Draft được có 0 line, được vượt tồn, được tham chiếu batch sắp hết hạn. **Submit (issue)** đòi đầy đủ như confirm về mặt line. **Confirm** chạy lại toàn bộ trong transaction: transition hợp lệ (guard T01), line đầy đủ theo ma trận T01 (dùng đúng checklist của trigger để lỗi typed luôn đi trước trigger — trigger chỉ là sàn, không phải bề mặt lỗi), batch **chưa hết hạn và quality cho phép** tại thời điểm confirm (hết hạn/quarantine → 422 cả hai loại), quy đổi UOM, cổng approval (issue), đủ tồn (issue). Batch phải tồn tại sẵn từ catalog — T03 không tạo batch; picker chỉ liệt kê batch có sẵn.

**R6 — UI tối thiểu, một form chung.** `/trading/receipts` + `/trading/issues` trong dx-lab: list (số, trạng thái, ngày) + form dùng chung parameterized theo type: chọn variant → batch picker (nhãn gồm mã batch, hạn dùng, tồn hiện tại) → warehouse → quantity + UOM (kèm preview số đã quy đổi từ server); hiển thị balance trước / dự kiến sau theo số đã quy đổi; issue hiển thị trạng thái approval, nút Confirm chỉ bật khi approved. Lỗi render theo type: 409 → "chứng từ đã thay đổi — tải lại"; 422 `INSUFFICIENT_STOCK` → hiện requested/available từng line; lỗi validation → theo field. Không inbox duyệt, không dashboard, không polish — P11 làm lại.

**R7 — Correction trong T03 chỉ ở mức link.** Tạo receipt/issue với `correctionOfDocumentId` + `correctionReason` hợp lệ thì chứng từ correction đi qua đúng lifecycle thường (receipt correction tự ghi movement theo line của nó). Không workflow correction riêng, không tự đảo gốc (đúng contract T01/T02).

## 4. File plan

| File | Việc |
| --- | --- |
| `contexts/trading/application/uom-conversion.ts` | MỚI. Một hàm quy đổi duy nhất (đọc hệ số catalog theo R0-d) + làm tròn + lỗi typed; unit test. |
| `contexts/trading/application/documents.ts` (hoặc tách receipt/issue services) | MỚI. Use case: create/edit/get/list/confirm/cancel (+submit cho issue), checklist confirm theo ma trận T01, chuẩn hoá line (R2), khoá + gộp nhu cầu (R3), cổng approval (R1). |
| `contexts/trading/application/http.ts` | MỚI (theo mẫu catalog). Helpers parse/validate body, map typed error → 409/422, project response (kèm stockQuantity preview khi draft). |
| `contexts/trading/index.ts` | Export application services + conversion + errors. |
| `composition/trading.ts` | MỚI (theo mẫu `composition/catalog.ts`): repos + audit recorder + bridge/inventory wiring. |
| `app/api/v1/receipts/route.ts`, `app/api/v1/receipts/[id]/route.ts`, `app/api/v1/receipts/[id]/[action]/route.ts` | MỚI theo cấu trúc route sẵn có của các resource tương tự (đối chiếu cách catalog resource tổ chức confirm/action routes nếu có; nếu pattern khác thì theo pattern thật). |
| `app/api/v1/issues/...` | Tương tự, thêm action `submit`. |
| `apps/dx-lab/...` (`/trading/receipts`, `/trading/issues`) | MỚI. List + form theo R6, dùng pattern page sẵn có của dx-lab. |
| `tests/platform/trading.integration.mjs` (mở rộng) hoặc file integration riêng của T03 theo pattern tests hiện có | AC-03/AC-04, race, rollback, idempotency, stale version, quy đổi (mục 6). |
| `documents/phase-plan/evidence/p07-t03.md` | MỚI. Kết quả bước 0 (R0) + lệnh/kết quả thật + mục chưa làm thuộc T07/T08. |
| `documents/phase-plan/evidence/source-inventory.json` | Refresh nếu thêm file nguồn (bài học T01/T02). |
| `documents/phase-plan/phase-07-trading.md` | Tick 3 checkbox T03 khi đạt thật. |

## 5. Commit plan (logical, theo thứ tự)

1. `feat(p07-t03): trading uom conversion and confirm checklist` — hàm quy đổi + typed errors + unit tests (kèm ghi kết quả bước 0 vào evidence draft).
2. `feat(p07-t03): goods receipt use cases and routes` — draft CRUD + confirm ghi tồn + cancel; integration: receipt 20 → balance 20, 1 movement/line, audit+outbox.
3. `feat(p07-t03): goods issue use cases with approval gate` — draft CRUD + submit nối bridge + confirm qua cổng R1 + cancel huỷ request; integration: approved issue 12 → balance 8; confirm trước duyệt → 409.
4. `test(p07-t03): concurrent confirm, idempotency and rollback battery` — race hai issue (gồm case hai line cùng batch + hai issue đa line ngược thứ tự line), ba lớp double-post, rollback đa line, stale version.
5. `feat(p07-t03): trading receipt and issue pages` — UI dx-lab theo R6.
6. `docs(p07-t03): evidence and phase checkboxes` — evidence hoàn chỉnh + tick checkbox.

Merge: Milo kiểm chứng xanh → merge `--no-ff` vào `phase-07`, push cả hai nhánh, giữ task branch. OpenCode KHÔNG tự merge, KHÔNG push.

## 6. Kiểm chứng (Milo tự chạy lại, trên PG thật qua harness dùng-một-lần)

- **AC-03:** receipt 20 (ít nhất một line nhập bằng UOM đóng gói, quy đổi ra số stock nguyên) → confirm → balance đúng 20.000; đúng 1 movement/line; audit + outbox cùng transaction; version tăng đúng 1 lần.
- **AC-04:** receipt 20 → issue 12 → submit → approve qua đường decision thật của bridge (actor khác) → confirm → balance đúng 8.000. Negatives: confirm trước khi duyệt → 409, không movement; tự duyệt → không đạt approved; cancel sau submit → approval request bị huỷ theo.
- **Race:** hai issue 12 cùng tranh balance 20, chạy đồng thời thật (hai connection, barrier đồng bộ): đúng 1 thành công, 1 nhận 422 `INSUFFICIENT_STOCK`; balance cuối 8; movement chỉ của bên thắng; bên thua 0 movement, status/version nguyên vẹn. Thêm case: một issue có 2 line cùng batch, tổng vượt tồn dù từng line đủ → 422, 0 movement. Chạy lặp race test nhiều vòng khi kiểm chứng để bắt flaky.
- **Double-post 3 lớp:** replay confirm cùng Idempotency-Key → response gốc, vẫn 1 movement/line; confirm lại bằng key mới → 409; submit replay → đúng 1 approval_request.
- **Rollback:** issue 3 line, line 3 thiếu tồn → 0 movement cả chứng từ, status/balance/audit/outbox không đổi; lỗi typed của use case luôn xuất hiện thay vì lỗi trigger thô (mỗi rule của checklist confirm có ít nhất 1 test khẳng định typed error).
- **Stale version:** PATCH và confirm với If-Match cũ → 409, không đổi trạng thái.
- **Quy đổi:** packing → stock đúng số; case làm tròn ở chữ số thứ 3 (HALF_UP); quy đổi ra 0 → 422; issue đã submit thì đổi hệ số quy đổi trong catalog không đổi số post khi confirm (đọc từ line đã chuẩn hoá).
- `npm test`, `npm run typecheck`, `npm run lint` xanh; Milo đọc tay luồng confirm đối chiếu thứ tự R3.

## 7. Rủi ro hội đồng đã bắt và cách plan xử lý

- **Duyệt giả làm hỏng bằng chứng AC-04** (cả hội đồng thống nhất): R1 cấm seed approved; decision đi đường thật của bridge.
- **Hash của bridge phủ giá trị đã lưu, không phủ giá trị quy đổi** (phản biện chỉ ra plan "hash theo số quy đổi" là không xây được nếu không sửa bridge): R2 chuẩn hoá line về stock UOM *trước* snapshot nên stored = approved = posted mà không đụng bridge.
- **Giả định khoá của `findBalancesOrdered` / balance chưa có row / ngữ nghĩa idempotency của pipeline đều chưa ai kiểm chứng:** R0 biến chúng thành bước đọc code bắt buộc có ghi evidence, trước khi code.
- **Batch của lô mới chưa có chủ sở hữu:** chốt ở R5 — batch là master data catalog, tạo qua API batches sẵn có; T03 chỉ tham chiếu; kịch bản demo/G07 phải tạo batch trước.
- **Hai line cùng batch tự vượt tồn:** R3 gộp nhu cầu theo batch trước khi kiểm.
- **Trigger validate biểu diễn đã lưu, không thấy số quy đổi trong bộ nhớ:** R2 khiến biểu diễn đã lưu (sau điểm chuẩn hoá) chính là biểu diễn post — trigger, hash và movement cùng nhìn một con số.

## 8. Lệnh cho OpenCode

- Làm việc **chỉ** trong `~/nexora-clean-check`, nhánh `phase07/p07-t03-receipt-issue`. Không đọc/ghi ngoài thư mục dự án, không đọc `deploy/instances/*.env`. Tool bị từ chối quyền: bỏ qua, làm tiếp.
- Làm **bước 0 (R0) trước**, ghi kết quả vào evidence; nếu sự thật khác giả định của plan ở điểm làm thay đổi thiết kế, dừng phần liên quan và ghi rõ vào evidence thay vì tự chế cơ chế mới.
- Không sửa các file plan untracked ở gốc repo. Không thêm dependency. File nguồn mới có header SPDX 1 dòng. Comment tối thiểu hoặc không.
- Test integration chạy trên harness Postgres dùng-một-lần có sẵn; việc Docker/PG nào không chạy được trong môi trường OpenCode thì ghi rõ vào evidence là chưa chạy — KHÔNG bịa kết quả, KHÔNG tick checkbox chưa kiểm chứng.
- Theo thứ tự commit mục 5; xong việc viết evidence trung thực, KHÔNG tự merge, KHÔNG push.

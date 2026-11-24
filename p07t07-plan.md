# P07-T07 — Flowable gắn với chứng từ thật — KẾ HOẠCH (đã qua LLM Council)

Trạng thái: ĐÃ DUYỆT (Thịnh duyệt 2026-11-23). Sau khi Thịnh duyệt: OpenCode chạy trên nhánh mới `phase07/p07-t07-flowable-documents` từ `phase-07` (@ e6a3c1e). Milo kiểm chứng độc lập (gồm `npm run build` + chạy lại hành trình gateway), merge `--no-ff` vào `phase-07`, giữ nhánh task, chờ CI.

## Nguồn sự thật
- `documents/phase-plan/phase-07-trading.md` mục P07-T07 + dòng AI handover (T07); `workflow-spec-v1.md` (BPMN/bridge); ADR 0006/D06 (Flowable 8.0.0, process key `goods-issue-approval`, candidate group `approver`).
- Hiện trạng đã kiểm chứng (P04 + T03): bridge sở hữu `approval_request` (requested/starting/pending/decision_pending/approved/rejected/cancelled/halted), worker qua outbox khởi động process, poller đối soát (reconciliation) đồng bộ trạng thái engine về; submit của T03 đã đi qua bridge thật; confirm kiểm bridge approved + hash snapshot dòng + scope hiện tại trong tx của nó (confirmApproval tiêu thụ trạng thái bridge); self-approve bị bridge chặn 403; hủy issue đã submit thì hủy luôn approval request (kể cả request đã approved — accessor `cancelApprovedRequest` của T03).
- **Divergence T03 để lại cho T07 (việc chính của task này):** bridge KHÔNG cập nhật `trading.document.status` — issue đã submit nằm ở `pending_approval` cho tới khi confirm nhảy thẳng lên `confirmed`, trong khi ma trận T01 đã đóng băng goods_issue phải đi qua `approved`/`rejected` (rejected là terminal, sửa = chứng từ mới).

## R0 — Bước 0 bắt buộc (đọc code trước, ghi vào evidence, không đoán)
1. Điểm reconciliation áp trạng thái terminal (hàm/tx cụ thể), cơ chế callback/port hiện có hay phải thêm; cách bridge ghi audit cho approval (để ghi anomaly theo R1).
2. Chữ ký decision service của bridge + cách test T03 điều khiển nó; đường cancel (cancelRequest + cancelApprovedRequest) và trạng thái nào chặn cancel.
3. approval_request lưu process definition id/version + process instance id ở đâu; reconciliation khớp kết quả engine bằng khóa gì (instance id + decision nonce hay yếu hơn — nếu yếu hơn thì sửa trong task này, xem R6).
4. Text chính xác của AC-12 trong tài liệu acceptance (đối chiếu hành trình ở R8).
5. Cơ chế hành trình gateway trên live stack: bootstrap/smoke scripts, lấy token Keycloak trong docker network, org/membership/user đã seed (kinh nghiệm G03/G04: gateway trong network là http://gateway:9080, token lấy tại http://keycloak:8080 trong network, file apisix.generated.yaml phải chmod 644 sau render).
6. File BPMN nằm ở đâu + cơ chế deploy process trong harness workflow/trading (để test nâng version ở R6 được cô lập trong engine dùng-thử-vứt).

## R1 — Đồng bộ quyết định: một chủ cho mỗi trạng thái, CAS không giao nhau
- **Bất biến mở đầu:** bridge là chủ duy nhất của `approval_request`; trading là chủ duy nhất của `document.status`; không ai ghi đè trạng thái terminal của ai.
- Reconciliation, **trong cùng transaction** với thay đổi approval_request → approved/rejected, gọi port do trading sở hữu `applyApprovalResult(documentId, result, nonce)` — port CAS document `pending_approval → approved` hoặc `pending_approval → rejected` (rejected = terminal). Đây là đường DUY NHẤT viết hai trạng thái này.
- Confirm đổi CAS: chỉ từ **`approved → confirmed`** (confirm từ `pending_approval` không còn tồn tại → 409 typed như hiện nay). Confirm vẫn kiểm lại bridge approved + hash snapshot + scope hiện tại trong tx của nó (phòng thủ hai lớp, không bỏ).
- Cancel giữ nguyên hành vi T03: hủy được từ `pending_approval` VÀ từ `approved` (trước confirm), luôn hủy kèm approval request tương ứng. Port đồng bộ không bao giờ chạy trên document đã cancelled/confirmed.
- **Kết quả đến muộn/xung đột:** kết quả engine mâu thuẫn với trạng thái terminal đã có (document/approval đã cancelled, hoặc đã rejected/approved ngược chiều) → ghi một **anomaly vào audit trail của approval_request** (loại kết quả, thời điểm, trạng thái hiện tại) rồi bỏ qua — không áp, không hồi sinh. Kết quả đến muộn nhưng HỢP LỆ (document vẫn `pending_approval`, ví dụ sau outage) phải được hấp thụ bình thường qua CAS — cấm chặn blanket mọi kết quả muộn.

## R2 — Worker kiểm lại trước khi gọi engine
- Trước MỌI lần gọi engine (start process, complete task theo decision intent), worker đọc lại state/version hiện tại của request: request đã cancelled (hoặc intent đã bị thay thế) → bỏ qua công việc đã xếp hàng. Cancel thắng intent chưa gửi — đây là chốt chặn ca "creator hủy trong lúc decision đang chờ worker".

## R3 — Inbox + decision API (bề mặt platform: `/api/v1/approvals`)
- `GET /api/v1/approvals/inbox`: chỉ task HÀNH ĐỘNG ĐƯỢC với actor — actor thuộc candidate group `approver` (theo membership của platform), còn scope kho bao phủ MỌI warehouse của document, actor ≠ creator, request ở trạng thái chờ quyết định. Payload mỗi item: {approvalRequestId, documentId, documentNumber, documentType, creatorSub, submittedAt, ageSeconds, warehouseIds, lineHash, approvalState, processDefinitionVersion}. (Tầm nhìn audit toàn bộ request thuộc về T08 history — inbox chỉ là hàng chờ hành động; trạng thái kẹt starting/halted nhìn thấy qua panel ở R7.)
- `POST /api/v1/approvals/{id}/decisions` body {decision: "approve"|"reject", note?} — chạy qua runCommand với **Idempotency-Key**: cùng key + cùng decision → replay response đã ghi; cùng key + decision khác → **409 IDEMPOTENCY_CONFLICT** (đúng ngữ nghĩa platform đã có). Kiểm đồng bộ theo thứ tự: policy → scope hiện tại → state còn quyết định được → self-approve **403** (bridge decision service là nơi thực thi, UI chỉ ẩn nút). Ghi intent + outbox TRƯỚC mọi cuộc gọi engine → trả **202** {approvalRequestId, state: "decision_pending", decision}. Response không bao giờ khai kết quả cuối.
- Policies (tên theo convention ở R0): `workflow:approval:read`, `workflow:approval:decide`.

## R4 — Expiry: ĐÓNG câu hỏi của T01 = KHÔNG có ở v1, ghi rõ lý do
- BPMN đã ghim không có timer; expiry tầng app để engine task treo (approver vẫn thấy task của một request đã chết — nguồn split-brain); expiry-kèm-hủy biến timeout thành một người ra quyết định thứ hai không ai chỉ định. V1: issue chờ tới khi có decision hoặc creator cancel; inbox hiển thị **tuổi request** để con người thấy độ cũ. Expiry đúng nghĩa (nếu sau này cần) phải đi cùng BPMN boundary timer để engine và app hết hạn nguyên tử — ghi deferral vào workflow-spec/evidence.

## R5 — Battery sự cố (mở rộng trading/workflow battery hiện có)
- **Flowable down:** tắt engine → submit (request + outbox tồn tại, document `pending_approval`, KHÔNG movement) + decision (202, `decision_pending`) → bật lại engine → hội tụ: đúng MỘT process instance cho mỗi request, approval về terminal, document được đồng bộ, Flowable history khớp trạng thái local, balance không đổi cho tới confirm.
- **Trùng kết quả:** chạy reconciliation hai lần cho cùng một kết quả → hiệu ứng một lần (CAS no-op).
- **Approve đến sau reject:** document giữ `rejected`, anomaly được ghi (R1), confirm → 409.
- **Cancel thắng intent chưa gửi:** decision đã ghi intent, creator cancel trước khi worker gọi engine → worker bỏ qua (R2), không process nào được complete, document `cancelled`, balance nguyên.
- **Rejected → confirm:** 409 (khẳng định lại sau khi có sync).
- **Không có stock trước approval:** mọi ca trên đều assert movement count/balance không đổi cho tới confirm hợp lệ.

## R6 — Nâng version process (cô lập trong harness)
- Trong engine dùng-thử-vứt của harness: submit A (v1) → deploy BPMN **v2 cùng key** (chỉ thay đổi bề ngoài — tên process — nhưng GIỮ NGUYÊN task key, candidate group, completion variables: đó là bề mặt contract) → submit B → assert trong engine history: A chạy definition version 1, B chạy version 2 → decide cả hai → mỗi kết quả đối soát về đúng document của nó → inbox liệt kê được task của cả hai version.
- Step 0 phải xác nhận reconciliation khớp bằng process instance id + decision nonce; nếu đang khớp bằng khóa yếu hơn (process key/latest) thì sửa trong task này và ghi vào evidence. Danh sách silent-breaker (đổi tên task key/form key/candidate group/completion variable) được ghi vào evidence như contract phải giữ khi sửa BPMN thật sau này — không cần test từng cái.

## R7 — UI
- `/trading/approvals`: inbox (danh sách actionable theo R3: số chứng từ, người tạo, tuổi, hash dòng rút gọn, nút Approve/Reject + note; trạng thái "waiting for workflow engine" khi request ở starting/decision_pending).
- Panel approval trên trang chi tiết issue: trạng thái bridge, trạng thái document, process instance id + definition version, lịch sử quyết định (gồm cả anomaly "late result ignored" nếu có).
- Trang [id] mới có `export const instant = false`; `npm run build` là gate cứng.

## R8 — Hành trình gateway AC-12 (live stack, scripted, ghi evidence)
- Đúng MỘT hành trình qua gateway thật trên live stack: creator submit → approver (user khác) đọc inbox qua gateway → approver thử self-approve trên issue của chính mình → 403 → approver quyết định issue kia → 202 → poller đồng bộ → document `approved` → confirm qua gateway → stock mới trừ lúc này. Script + output lưu vào evidence.
- Hành trình này tick checkbox HTTP end-to-end cho riêng đường approval (phần còn lại của ma trận HTTP vẫn thuộc T08/G07 — ghi rõ, không nhận quá).

## Commits (đúng thứ tự, mỗi commit tự xanh test+typecheck+lint; build ở commit UI)
1. `feat(p07-t07): sync approval result to document status` — port R1 + confirm CAS mới + quy tắc cancel/kết quả muộn.
2. `feat(p07-t07): worker rechecks request before engine calls` — R2 + ghi anomaly.
3. `feat(p07-t07): approver inbox and decision api` — R3.
4. `test(p07-t07): outage duplicate late-result and version upgrade battery` — R5 + R6.
5. `feat(p07-t07): approvals inbox ui and issue approval panel` — R7; `npm run build` pass.
6. `docs(p07-t07): gateway journey evidence and phase checkboxes` — R8 + deferral expiry (R4) + silent-breaker list (R6); checkbox UI/HTTP ghi trung thực phạm vi đã chạy (scripted gateway journey, không phải browser session).

## Kiểm chứng (Milo chạy lại độc lập, không tin self-report)
- `npm test`, `npm run typecheck`, `npm run lint`, **`npm run build`**.
- `npm run test:platform:schema` rồi `npm run test:platform:trading` và battery workflow liên quan — TUẦN TỰ.
- Đọc tay: port đồng bộ là đường viết approved/rejected duy nhất (grep các điểm ghi document.status); confirm không còn đường từ pending_approval; worker có recheck trước engine call.
- Milo tự chạy lại script hành trình gateway (R8) trên live stack khi stack dựng được; nếu stack không dựng được trong phiên kiểm chứng, ghi rõ và chỉ tick checkbox theo mức đã chứng minh.

## Ngoài phạm vi (ghi rõ)
- Approval expiry (R4 — đóng câu hỏi T01 minh bạch, không phải bỏ sót).
- Ma trận HTTP end-to-end đầy đủ + browser journey → T08/G07.
- History query tổng hợp đa module → T08.
- Đổi BPMN thật (v2 ở R6 chỉ là fixture test trong harness cô lập).

## Council — đã bác
- Không đồng bộ, để UI tự suy trạng thái từ bridge (phương án b): ma trận T01 đóng băng sẽ sai vĩnh viễn — giám khảo đối chiếu phase doc với UI là lộ.
- Đồng bộ ngay trong decision API (phương án c): decision là async theo thiết kế (intent trước, engine sau) — API khai kết quả đồng bộ là nói dối.
- Expiry tầng app / auto-cancel theo giờ: tạo split-brain hoặc một người ra quyết định không ai chỉ định.
- Chặn blanket mọi kết quả đến muộn: kết quả hợp lệ sau outage chính là thứ recovery phải hấp thụ; chỉ kết quả XUNG ĐỘT với trạng thái terminal mới bị bỏ qua + ghi anomaly.
- Cancel chỉ từ pending_approval: làm kẹt issue đã approved-chưa-confirm — hành vi T03 (hủy được cả request đã approved) phải giữ.

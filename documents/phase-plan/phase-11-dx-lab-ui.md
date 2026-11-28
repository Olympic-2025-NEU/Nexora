# Phase 11 — Ứng dụng H-P-D-I và UX xuyên module

**Mục tiêu:** một ứng dụng tầng 2 dùng lõi headless thật qua gateway, hoàn thành luồng demo bằng UI. **Phụ thuộc:** G02–G10, D10. **AC:** UI cho AC-02…12, bằng chứng H-P-D-I.

## P11-T01 — Chốt ứng dụng tầng 2 và bản đồ service

- [x] Định nghĩa **DX-Lab Operations Workspace** là một ứng dụng frontend/runtime riêng tầng 2 trong cùng monorepo theo D15; H = môi trường làm việc cá nhân/SSO/hồ sơ, P = giao nhận/phê duyệt, D = tồn/trace/impact, I = AI tra cứu/Draft. Không tuyên bố bốn sản phẩm độc lập.
- [x] Vẽ route→gateway→core data/file API/ERP business API→DB/storage/Flowable map và chứng minh UI không cần gọi trực tiếp DB hay API admin của engine. Core vẫn chạy/được smoke test khi cả DX-Lab và ERP UI tắt.
- [x] ADR D10 ghi user journey tối thiểu cho Admin, Staff, Approver, Viewer và public; chọn dữ liệu A/B/C để dùng xuyên màn hình. [Bằng chứng T01](evidence/p11-t01.md).
- **Đầu ra:** app map + service call trace; **kiểm chứng:** headless API script chạy độc lập UI.

## P11-T02 — Shell, session và điều hướng theo quyền

- [x] Build/deploy frontend tầng 2 độc lập (`apps/dx-lab/` cùng Next/React), OIDC login/logout/session refresh, org/role context từ server, navigation có quyền; CI/build image riêng, không dựa vào ẩn nút để bảo mật.
- [x] Route bảo vệ phản hồi 401/403/session-expired rõ, preserve intended path nếu an toàn; token không lộ qua browser logs/URL.
- [x] Keyboard focus, semantic labels, mobile navigation, dark/light nếu nằm trong design scope; test viewport mobile/desktop và screen reader cơ bản.
- **Đầu ra:** app shell; **kiểm chứng:** Admin/Staff/Approver/public nhìn đúng luồng, backend vẫn chặn đường vòng.
  [Bằng chứng T02](evidence/p11-t02.md). Đánh giá screen reader toàn diện của các hành trình H/P/D/I thuộc G11/T08.

## P11-T03 — H: tổ chức và người dùng

- [ ] Trang công việc cá nhân có approval/receiving tasks, tệp/hồ sơ liên quan qua core file API, org profile, membership/role và partner connection dùng M01 API; trạng thái kết nối/rotation chỉ hiển thị metadata an toàn. UI đã bổ sung receiving inbox/Core File metadata; chờ thử vai trò và dữ liệu A/B/C.
- [x] Form validation, optimistic conflict, save/error/permission-denied; Admin có thể mời/disable, Staff không truy cập route admin.
- [ ] Handoff từ H sang P: actor và partner được chọn đúng trong giao dịch, không đổi org ID trong request. Contract đã dùng partnerId; chờ hành trình A/B/C.
- **Đầu ra:** H journey; **kiểm chứng:** AC-02 qua UI trên A/B/C.
  [Bằng chứng T03](evidence/p11-t03.md).

## P11-T04 — P: giao dịch, nhận hàng và approval inbox

- [x] Product/batch/warehouse picker, receipt/issue/transfer Draft editor; hiển thị quantity/unit/expiry/quality/balance và validation từ server.
- [ ] Approval inbox liên kết Flowable task; approve/reject trả `decision_pending` tới khi worker/poller đối soát, reject cần reason; sau đó người có quyền confirm; người tạo không tự duyệt theo D06 v1. Code có; chờ browser rehearsal bằng hai actor.
- [ ] Receiver thấy sent vs actual, discrepancy và technical ACK tách khỏi business receipt; UI retryable/offline/rejected states và lịch sử action. UI có chi tiết nhận hàng; chờ chứng minh luồng B/C thật.
- **Đầu ra:** P journey; **kiểm chứng:** AC-03/04/06/12 thực hiện được không mở DB/Flowable admin UI.
  [Bằng chứng T04](evidence/p11-t04.md).

## P11-T05 — D: tồn, timeline và impact

- [ ] Dashboard tồn theo lô/kho, document history, A→B→C timeline với source/verification/gap/staleness; link tới bằng chứng clean có quyền. Màn hình dùng API thật; chờ dữ liệu và hành trình A/B/C.
- [x] Backward và forward trace từ một lô, affected partner/document list, filters/pagination; dùng số liệu từ API, không hardcode fixture vào UI.
- [ ] Passport public mobile và QR scan có design dễ đọc, chỉ field allowlist; trường private không xuất hiện ở DOM/network response. Code đã có QR/passport allowlist; chờ quét điện thoại và privacy snapshot với token thật.
- **Đầu ra:** D journey; **kiểm chứng:** AC-07/08/09 UI và privacy snapshot.
  [Bằng chứng T05](evidence/p11-t05.md).

## P11-T06 — I: AI panel và human-in-loop

- [ ] Panel hỏi lot có disambiguation, source citations, trạng thái thiếu dữ liệu và quyền; loading/timeout/fallback truy vấn trực tiếp. UI đã có; chờ provider và thử AC-10/11.
- [ ] Draft suggestion mở form M03 với dữ liệu AI đề xuất, người dùng xem/sửa và thực hiện action riêng; UI không tự confirm khi model trả “đã xong”. Form đã có; chờ thử trên AI/ERP Phase 10.
- [ ] Thể hiện AI source/time và cảnh báo giới hạn trong ngữ cảnh, không che giấu trạng thái partner-asserted. UI đã có; chờ đối chiếu payload thật.
- **Đầu ra:** I journey; **kiểm chứng:** AC-10/11 qua UI với role ít quyền và provider down.
  [Bằng chứng T06](evidence/p11-t06.md).

## P11-T07 — Luồng xuyên module và trạng thái lỗi

- [x] Tạo navigation/notification link từ transfer tới receiver inbox, từ receipt tới trace, từ risk insight tới batch/document; URL an toàn và permission check ở từng đích.
- [x] Empty/loading/error/409 conflict/429 rate limit/503 core down/retry states có thông điệp hành động được, không làm người dùng double-submit.
- [ ] Dữ liệu A/B/C được tạo bằng seed/API; test e2e bằng browser cho kịch bản chính và ít nhất một kịch bản lỗi mạng. Chrome A + lỗi mạng PASS; B/C và luồng giao dịch xuyên instance chờ rehearsal.
- **Đầu ra:** UX e2e suite; **kiểm chứng:** người ngoài nhóm chạy được kịch bản bằng runbook.
  [Bằng chứng T07](evidence/p11-t07.md).

## P11-T08 — Khả dụng, đo lường và gate G11

- [ ] Kiểm tra keyboard/tab order, labels, contrast, responsive, long strings, timezone/decimal, QR trên điện thoại; sửa blocker demo. Chrome/axe A ở 360px và desktop PASS; screen reader/QR điện thoại và B/C chờ kiểm tra thủ công.
- [x] Ghi service-call trace cho từng vùng H/P/D/I và test tắt cả DX-Lab/ERP UI vẫn gọi được core API qua gateway. Không dùng mock làm bằng chứng gate.
- **Bằng chứng:** e2e run/video đã redacted, accessibility checklist, gateway traces, UI screenshots trên mobile/desktop.
  [Bằng chứng T08 / G11](evidence/G11.md) · [p11-t08](evidence/p11-t08.md).

**Trạng thái sau rà soát 2026-11-27:** G11 mở cho các bước thủ công trong [hướng dẫn nghiệm thu](evidence/G11-manual-rehearsal.md). Không dùng checkbox đã tick trước đây làm bằng chứng thay cho browser A/B/C và screen reader.

## Hồ sơ giao AI theo từng task

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P11-T01 | `apps/dx-lab/` Next frontend riêng + `ui-ai-spec-v1.md` route map H/P/D/I; diagram gateway→core/ERP services. | Tắt DX-Lab/ERP UI vẫn smoke core SSO/gateway/data/file/Flowable; app tầng 2 không DB credential. |
| P11-T02 | `apps/dx-lab/app/(workspace)/layout.tsx`, auth callback/session/nav, typed `lib/api-client` từ OpenAPI. | Login/logout/expiry/deep link, 401/403 và role nav; cookie/token không log/URL/localStorage trái ADR. |
| P11-T03 | `/work`, `/profile`; org/members (ERP `/admin/*` concepts); partners (ERP `/partners`); `ApprovalInbox` preview. | Admin edit, Staff 403; secretRef write-only; A/B/C org context đúng, empty/error/409 states. Do not mount catalog under admin. |
| P11-T04 | `/operations/{receipts,issues,transfers,receivings}`, `/work/approvals`; `BatchPicker`, `DocumentEditor`, `ReceivingCompare`, `ApprovalInbox`. | UI làm AC-03/04/06/12, sent vs actual tách ACK, reject/self-approve/server 403, double submit không nhân movement. |
| P11-T05 | `/data/inventory`, `/data/lots/[id]`, `/data/impact/[id]`, `/passport/[token]`; `TraceTimeline/ImpactGraph/PassportView`. | AC-07/08/09 qua UI, mobile QR, gap/source/asOf/verification rõ; DOM/network public không private fields. |
| P11-T06 | `/assistant` + `AiPanel/DraftReview`, tool source list và editable Draft link. | AC-10/11 UI; provider down fallback, user thiếu quyền tool 403, AI không tự confirm. |
| P11-T07 | Navigation/notification cross-link, loading/empty/409/429/503 states, Playwright A/B/C fixtures. | Người không viết UI hoàn thành A→B→C bằng browser, lỗi mạng không mất Draft hoặc double confirm. |
| P11-T08 | `evidence/G11.md` viewport 360px/desktop, keyboard/labels/contrast, e2e logs, gateway trace theo H/P/D/I. | DX-Lab build/run riêng và gọi core/ERP thật; mock/screenshot không đủ gate. |

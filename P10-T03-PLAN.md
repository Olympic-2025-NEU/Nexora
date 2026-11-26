# P10-T03 — Tra cứu lô có dẫn nguồn (Sourced Lot Lookup Q&A): Implementation Plan

**Trạng thái:** Hội đồng đã họp xong (5 cố vấn + phản biện chéo, nhất trí cao). Chờ Thịnh duyệt mới code.
**Nhánh:** tạo `phase10/p10-t03-lot-lookup` từ `phase-10` (HEAD 9e63549). Merge --no-ff vào `phase-10` sau kiểm chứng, GIỮ nhánh task.
**Người làm:** Thịnh tiếp quản 26/11 (Minh bận, Khương đã xong T01/T02). Demo: thứ Bảy 28/11 20:30 với thầy Linh.

## Hiện trạng đã kiểm chứng trong code (26/11)

- **T01:** adapter Python `services/ai` — POST `/v1/generate` chỉ nhận `{question, facts[]}` (≤10 facts, mỗi fact `{kind, value, sourceId, asOf, verification}`), chặn field lạ/PII/credential, cần internal token, gọi Ollama local `qwen3:0.6b` Q4_K_M; provider down → 503 `AI_UNAVAILABLE`. Model CHƯA được pull trên máy dev.
- **T02:** tool registry `contexts/ai/application/` (execute-tool.ts, tool-registry.ts, ports.ts), 5 tools với JSON schema chặt ở `services/ai/tools/`; thực thi bằng Bearer của chính user qua loopback tới API M02/M03/M04; quota PG 30 call/phút (draft 5/phút); `getLot` tra cặp lô gốc giới hạn 10 trang, báo ambiguous/truncated thay vì tự chọn.
- **Lỗ hổng AC-10 (đã kiểm chứng):** `tool-audit.ts` — hàm `complete()` chỉ ghi `after: { tool, sourceIds }` + outcome. **Audit KHÔNG lưu giá trị số.** Cụm từ nghiệm thu của T03 "tool audit khớp mọi con số trọng yếu" hiện KHÔNG kiểm chứng được bằng dữ liệu audit T02. Kế hoạch này xử lý ở R5.

## Chairman rulings (bắt buộc, không thương lượng khi code)

- **R1 — Model không bao giờ viết số.** Mọi con số, đơn vị, source ID, timestamp, trạng thái verification trong câu trả lời đều do code render xác định (deterministic template) từ fact bundle. Model chỉ được sinh tối đa một câu nối ngắn; câu đó bị kiểm tra hậu kỳ (R5b) — chứa số/ID lạ → loại bỏ, giữ bản template. AC-10 đạt theo cấu trúc, không theo hy vọng model nghe lời.
- **R2 — Không model chọn tool, không model phân tích ý định có thẩm quyền.** Resolver xác định: trích ứng viên mã lô bằng pattern + tra catalog/product qua tool sẵn có. Model không tham gia parsing.
- **R3 — Disambiguation là trạng thái backend, không phải hội thoại.** `POST /ai/chat` trả `{status:"ambiguous", candidates:[...]}` và DỪNG (không gọi generation). Client chọn rồi POST lại kèm `batchId`. Không xây conversation store. **Candidates phải lọc theo quyền của actor** (chỉ issuer/tổ chức actor được xem) — danh sách ứng viên là bề mặt rò rỉ thông tin, không được lộ lô của tổ chức actor không có quyền.
- **R4 — Chính sách chọn facts xác định, ghi thành văn bản.** Từ kết quả getLot + getStock + getTrace, chọn ≤10 facts theo thứ tự ưu tiên cố định: (1) định danh lô (issuer/product/lot code), (2) tổng tồn hiện tại + đơn vị, (3) tồn theo kho (tối đa 3 kho), (4) sự kiện trace mới nhất (tối đa 3, mới → cũ), (5) trạng thái verification/gap. Cắt bỏ bất cứ phần nào → câu trả lời PHẢI nói rõ đã cắt ("hiển thị 3 sự kiện gần nhất trong tổng số N"). Không im lặng cắt.
- **R5 — Vá lỗ hổng audit cho AC-10.** Khi trả lời xong, ghi một audit entry `ai.chat.answer` với các giá trị then chốt đã render (quantity, unit, sourceIds, asOf, requestId) — không ghi prompt, không ghi text của model. Golden test đối chiếu answer ↔ audit entry ↔ tool result cùng request.
  - **R5b — Verifier hậu kỳ:** mọi số/đơn vị/source ID xuất hiện trong phần text model sinh phải thuộc fact bundle; vi phạm → bỏ phần text đó, dùng bản template thuần.
- **R6 — Dữ liệu đối tác là dữ liệu, không phải lệnh.** Tên lô/sản phẩm và text partner-asserted là input không tin cậy: escape dạng plain text trong template, loại nội dung dạng chỉ thị trước khi đưa vào facts cho adapter (adapter đã chặn pattern credential/contact; lớp orchestration chặn thêm mẫu câu lệnh hướng tới AI).
- **R7 — Golden tests bằng TIẾNG VIỆT, dựng từ đúng dữ liệu seed demo A/B/C** (gồm một mã lô trùng giữa hai issuer). CI mock provider theo contract của adapter; thêm một script smoke chạy model thật trên máy dev (không vào CI). Kịch bản test: khớp số fixture; lô không tồn tại; mã trùng khác issuer; provider down (503 → fallback); actor thiếu quyền kho → 403. Actor demo là user Keycloak seed có tên cố định; có case demo đường bị từ chối quyền.
- **R8 — Cắt panel trang lô khỏi T03.** T03 chỉ ship trang `/assistant`. Panel trên trang lot/document hoãn sang task sau (T03b hoặc gộp T06). Theo luật của đội (Khương, 25/11): sửa plan phải cập nhật file spec — cập nhật `documents/phase-plan/phase-10-ai.md` và `documents/phase-plan/ui-ai-spec-v1.md` ghi rõ hoãn panel, trong cùng đợt thay đổi.
- **R9 — Xương sống demo trước.** Hôm nay, trước khi code UI: pull `qwen3:0.6b`, bật profile `ai` trên instance A, seed fixture demo (mã lô trùng hai issuer), smoke adapter + tools đầu-cuối, và pre-warm model. Fallback của demo = câu trả lời template (chạy được cả khi `AI_PROVIDER=none`).
- **R10 — Trình bày có giới hạn (từ Expansionist).** Thẻ trả lời hiển thị chip nguồn (giá trị + đơn vị + source + asOf + badge verification) render từ dữ liệu có cấu trúc — KHÔNG bóc từ text model — kèm dòng "đã đối chiếu với N lượt gọi tool". Source ID link về trang trace sẵn có. Không xây drill-down mới.

## Luồng chính (main flow)

1. User POST `/ai/chat` `{question}` (Bearer Keycloak như mọi route ERP).
2. Resolver trích mã lô ứng viên (pattern) → gọi `getLot` qua registry (đúng Bearer của actor, quota/audit T02 lo).
   - 0 kết quả → trả `{status:"not_found"}` + gợi ý xem trực tiếp trang trace.
   - >1 ứng viên (sau lọc quyền) → trả `{status:"ambiguous", candidates}` — dừng.
   - 1 kết quả → đi tiếp.
3. Gọi `getStock` + `getTrace` cho batch đã chốt → dựng **fact bundle** theo R4 (kèm cờ truncated nếu có).
4. Render câu trả lời template từ fact bundle (đây là đáp án chuẩn).
5. Nếu `AI_PROVIDER=ollama`: gọi adapter `/v1/generate` với question + facts → nhận câu nối → qua verifier R5b → gắn vào đáp án nếu sạch. Adapter 503/timeout → bỏ qua lặng lẽ, đáp án template đứng một mình + cờ `AI_UNAVAILABLE` cho UI hiển thị fallback link.
6. Ghi audit `ai.chat.answer` (R5). Trả `{status:"answered", answer, facts, sources, auditRequestId}`.

## Tệp dự kiến

- `contexts/ai/application/chat-lot-lookup.ts` — orchestration: resolver + fact bundle + template render + verifier (SPDX header).
- `contexts/ai/application/chat-lot-lookup.test.ts` — unit tests resolver/render/verifier.
- `contexts/ai/infrastructure/ai-generate-client.ts` — client gọi adapter `/v1/generate` (internal token, timeout 30s, không log prompt).
- Route `POST /ai/chat` — theo pattern composition hiện hữu (`composition/ai.ts` mở rộng), không mở public `/ai/tools`.
- `apps/web` (theo cấu trúc trang hiện tại): trang `/assistant` — ô hỏi, candidate picker, thẻ trả lời + chip nguồn, trạng thái AI_UNAVAILABLE. **Trang mới PHẢI có `export const instant = false`** (bài học P07-T04: thiếu là CI build fail dù lint/typecheck xanh).
- `tests/ai/` golden fixtures tiếng Việt + test AC-10 (answer ↔ audit ↔ tool result).
- `documents/phase-plan/evidence/p10-t03.md`; cập nhật spec theo R8.
- File mới → chạy `node scripts/check-spdx.mjs --write-inventory`.

## Thứ tự commit

1. `chore(ai): enable local model demo profile and seed duplicate-lot fixture`
2. `feat(ai): add sourced lot chat orchestration` (resolver, fact bundle, template, verifier, audit entry, route)
3. `test(ai): add T03 golden and failure fixtures` (kèm AC-10 audit-match)
4. `feat(web): add assistant lot lookup page`
5. `docs(phase-10): record T03 evidence and defer lot-page panel`

## Kiểm chứng (Milo tự chạy lại, không tin self-report)

- `npm run test:ai:tools` (giữ 7/7), unit tests mới của chat-lot-lookup, golden tests T03.
- `npm run test:platform:ai-tools` nếu chạm audit/quota (có chạm: thêm action `ai.chat.answer` — kiểm tra không phá quota đếm theo `ai.tool.reserve`).
- `npm run typecheck`, `npm run lint` (--max-warnings=0), `npm run build` (có trang mới — bắt buộc).
- Smoke model thật trên instance A: hỏi đúng fixture demo → số khớp API; tắt Ollama → fallback template vẫn trả lời.
- CI xanh trên nhánh task trước khi merge --no-ff vào `phase-10`; push cả hai nhánh; giữ nhánh task.

## Ngoài phạm vi T03 (không làm)

- Model tự chọn tool / hội thoại nhiều lượt / bộ nhớ chat.
- Draft chứng từ (T04), risk rules (T05), adversarial suite (T06).
- Panel trên trang lot/document (hoãn theo R8).
- Streaming, đổi model lớn hơn (chỉ xem lại ở G10 nếu chất lượng không đạt — ADR D09 đã ghi).

## Đường thực thi (Thịnh chốt 2026-11-26)

Phối hợp 4 bên: **Council** ra plan (đã xong) → **LangGraph** điều phối các bước chạy → **OpenCode** viết code với model **`opencode/big-pickle`** (Thịnh chỉ định 2026-11-26; đã set làm model mặc định trong `~/.config/opencode/opencode.jsonc` trên máy Fedora) → **Milo** kiểm chứng độc lập rồi merge theo luật.

**Điểm dừng báo trước:** bước cài model thủ công duy nhất của T03 là pull `qwen3:0.6b` vào Ollama (~523 MB, thuộc commit 1 — xương sống demo). Đến bước đó Milo báo Thịnh trước, không tự chạy.

# P04-T01 PLAN — Command pipeline thực thi được (Nexora, Phase 4)

Nguồn: `documents/phase-plan/phase-04-workflow-events.md` mục P04-T01 + hàng "Hồ sơ giao AI".
Plan do LLM Council chốt 2026-11-19 (5 advisors + peer review), Milo tổng hợp, OpenCode thực thi, Milo kiểm chứng.

## Hiện trạng đã kiểm chứng
- `platform/http/pipeline.ts` hiện CHỈ là mảng string: `["authenticate","resolve-tenant","authorize","idempotency","domain","commit"]` + type `CommandStep`. Chưa có gì thực thi nó.
- `platform/index.ts` có tham chiếu `commandPipeline` — PHẢI kiểm tra mọi consumer trước khi thay (commit 1).
- Mảnh có sẵn để tái dùng: `platform/persistence/transaction.ts` (Prisma unit-of-work, P03-T02), `platform/identity/resolve-actor.ts` + `partner-actor.ts`, `platform/access/policy.ts`, `platform/audit/` (recorder ghi TRONG transaction — giữ nguyên thiết kế P03), correlation ID có sẵn từ P03-T03.
- Nhánh: tạo `phase-04` từ `phase-03` (05ee42a — đã chứa P01+P02+P03; develop đang stale ở Phase 1). Task branch: `phase04/p04-t01-command-pipeline`.

## Quyết định của hội đồng (chốt, không bàn lại khi code)
1. **Explicit runner, không middleware chain.** `runCommand` trong `platform/http/pipeline.ts` chạy các step theo đúng thứ tự của mảng `commandPipeline` (mảng tên step GIỮ LẠI làm registry thứ tự chuẩn — một nguồn sự thật duy nhất). Route không được bỏ qua hay đảo thứ tự step.
2. **Pipeline mở transaction** bằng unit-of-work có sẵn, SAU khi authorize xong, rồi trao `ctx.tx` cho domain step. Nhờ vậy test "auth fail → không mở transaction" viết được ở tầng pipeline (spy vào transaction factory/UoW, KHÔNG chỉ kiểm tra DB rỗng).
3. **Port fail-closed.** `IdempotencyPort` (vòng đời reserve-trước-execute / complete-sau-commit) và `DispatchPort` chỉ là interface ở T01; adapter `Unimplemented*` NÉM LỖI nếu bị gọi. TUYỆT ĐỐI không no-op, không in-memory (đó là giả lập hành vi của T02/T03). Route chỉ chạm port khi tự khai báo cần (vd có Idempotency-Key) — route chưa khai báo thì step bỏ qua mà không gọi port.
4. **Audit giữ nguyên trong transaction** như P03: domain step tự ghi audit bằng recorder có sẵn bên trong tx; pipeline bảo đảm ctx mang đủ actor + requestId/correlation cho recorder. KHÔNG biến audit thành step hậu-commit.
5. **requestId = correlation ID có sẵn của P03** (lấy từ header nếu có, không có thì mint một lần ở mép route) — không tạo hệ từ vựng truy vết thứ hai.
6. **resolve-tenant đọc DB TRƯỚC khi mở transaction** (membership → organization của actor, theo mô hình P02/P03); tenant KHÔNG lấy từ header do client gửi. Có test cross-tenant denial.
7. **Hậu-commit không rollback được:** dispatch ở T01 chưa có route nào dùng; khi T03 đến, lỗi dispatch chỉ log/lỗi vận hành, client vẫn nhận kết quả đã commit. Ghi rõ bất biến này trong code comment + evidence.
8. **Error mapping là bảng riêng** `platform/http/error-mapping.ts` theo `documents/phase-plan/api-payloads-v1.md`; route handler chỉ còn: parse → runCommand → map response.
9. **Chỉ migrate MỘT route:** `app/api/v1/federation/events/route.ts`. Route này dedupe bằng federation inbox sẵn có trong domain step (KHÔNG dùng IdempotencyPort của user command — phân biệt đúng như lưu ý ở P04-T02). Nếu không giữ nguyên được hành vi hiện tại của route, DỪNG và báo cáo, không tự chế cách khác.

## Typed context
`CommandContext { requestId, actor, tenantId, tx? }` — step sau không được thay actor/tx của step trước (test contract: gán lại actor/tx giữa chừng phải bị chặn hoặc bị phát hiện).

## Thứ tự commit (mỗi commit một việc logic, chạy test liên quan sau mỗi commit)
1. `feat(p04-t01): add typed CommandContext and step runner` — kiểm tra consumer của `commandPipeline` trước; giữ mảng tên step làm registry.
2. `feat(p04-t01): implement authenticate, resolve-tenant and authorize steps` — wire resolve-actor (gồm partner-actor), membership→organization, access/policy.
3. `feat(p04-t01): add fail-closed idempotency and dispatch ports` — interface + Unimplemented adapters.
4. `feat(p04-t01): add transaction step and DomainError mapping` — UoW + `error-mapping.ts`.
5. `test(p04-t01): pipeline order, short-circuit and context contract tests` — gồm: instrument order; fail auth/authorize → step sau không chạy; spy UoW chứng minh auth fail → transaction factory không hề được gọi; cross-tenant denial; error shape đúng api-payloads-v1.
6. `refactor(p04-t01): migrate federation events route onto the pipeline` — giữ nguyên hành vi + dedupe inbox.
7. `docs(p04-t01): add evidence and close T01 checkboxes` — `documents/phase-plan/evidence/p04-t01.md`; tick các checkbox T01 trong `phase-04-workflow-events.md` đúng phần đã làm.

## Kiểm chứng (Milo làm sau khi OpenCode xong)
- Đọc từng commit + diff; chạy test suite của repo (`npm test` — gồm check SPDX + license inventory; nếu có thay đổi dependency thì refresh inventory trong cùng commit theo bài học T07).
- Đối chiếu: mảng step còn là nguồn thứ tự duy nhất; route federation/events mỏng đi và hành vi không đổi (test cũ của route vẫn xanh).

## Ngoài phạm vi T01 (không làm)
- Idempotency record thật (T02), outbox/worker (T03), Flowable (T05–T06) — chỉ để interface.
- Không migrate thêm route nào khác. Không sửa `deploy/instances/*.env`. Không đụng main/develop.

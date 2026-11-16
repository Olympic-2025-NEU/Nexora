# D06 — Workflow BPMN có trạng thái bền vững

- Ngày: 2026-11-17. Trạng thái: **chọn Flowable OSS REST 8.0.0 + PostgreSQL riêng**; engine spike pass, app bridge/reconciler và reviewer G00 còn mở.
- Câu hỏi: làm sao chứng minh Workflow lõi chạy thật và tích hợp GoodsIssue mà không làm transaction phân tán app DB/engine DB?
- Quyết định: `flowable/flowable-rest:8.0.0@sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d`, PostgreSQL 17 DB/role riêng. Process key `goods-issue-approval`, BPMN versioned; **mọi GoodsIssue v1** cần Approver khác creator. App ghi intent/outbox, worker start/complete task idempotent và reconciler cập nhật app approval state; `GoodsIssue.confirm` chỉ chạy khi app đã xác minh approved và snapshot lines. Không gọi Flowable trong cùng PG transaction hay tin UI task tự đổi tồn. Source [Apache-2.0](https://github.com/flowable/flowable-engine/blob/flowable-8.0.0/LICENSE), [REST docs](https://www.flowable.com/open-source/docs/bpmn/ch14-REST).

## Spike

[BPMN và smoke](../phase-plan/evidence/spikes/infra/README.md): deploy process v1, start hai instance, mỗi instance có một user task; restart Flowable vẫn truy được task; complete `approved=true` đi `approvedEnd`, `false` đi `rejectedEnd`, history còn. REST anonymous 401; admin mặc định `rest-admin:test` 401; admin thử riêng 200. Biến đúng cho image 8.0.0 là `FLOWABLE_REST_APP_ADMIN_USER_ID/PASSWORD`; biến admin kiểu cũ từng để default credential mở trong thử ban đầu, đã sửa và negative test. Flowable container RAM **316.9 MiB snapshot**, PG riêng **70.36 MiB**; không phải peak hay cả ba instance.

## Ảnh hưởng và kiểm tra còn lại

P04 phải viết bridge/retry/reconcile theo `workflow-spec-v1.md`, timeout/duplicate/engine-down tests, không dùng H2 hoặc credential demo trong release. P07 phải kiểm creator≠approver ở app policy, reject reason, line snapshot hash, pending/reject không movement/outbox issue confirmed; engine task không tự là bằng chứng người có quyền. Cần pin migration/backup DB Flowable, bảo vệ REST/admin plane và đo restart/failure trên stack thật. Không xem engine spike là AC-12 đã đạt.

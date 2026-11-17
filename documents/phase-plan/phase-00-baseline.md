# Phase 00 — Baseline, nguồn mở và khóa hợp đồng

**Mục tiêu:** biến repo scaffold thành điểm xuất phát đo được; đóng quyết định chặn core trước khi code. **Phụ thuộc:** không. **Unblock:** Phase 01–04. **Không được gọi Done:** chỉ có tài liệu nhưng chưa kiểm tra build, bản quyền hoặc contract.

## P00-T01 — Kiểm kê mã, tài sản và khoảng trống

- [x] Chụp `git status`, tree, dependency lock, route hiện có, migration 0 byte, Compose chỉ PG, test hiện có và version Node; phân loại code chuẩn đích vs scaffold `sales|procurement|finance|master-data`.
- [x] Ghi danh mục file tự viết, template code, SVG/ảnh/font/tài sản bên thứ ba và nguồn gốc để biết file nào gắn SPDX, file nào cần giữ notice riêng.
- [x] Chạy build/lint/typecheck baseline trên clone sạch; lưu lỗi hiện tại riêng với lỗi do phase sau đưa vào.
- **Đầu ra:** baseline report và issue cho từng gap; **kiểm chứng:** người khác tái tạo được các lệnh, không ghi “module hoàn thành” theo tên folder.

## P00-T02 — Chuẩn hóa nghĩa “xong” và phạm vi

- [x] So Ch6/AC-01…13 với đề thi mục 3–4, bảng `test-matrix.md`; đánh dấu bắt buộc, mở rộng, ngoài MVP cho từng yêu cầu.
- [x] Chốt demo dọc A→B→C và một ứng dụng H-P-D-I; tạo tập tình huống happy/error/offline trước khi viết schema.
- [ ] Xác minh với BTC mốc nộp bài vì đề thi ghi 2025 còn thể lệ có lịch 2026; lưu phản hồi, không suy từ PDF cũ.
- **Đầu ra:** scope statement, demo acceptance narrative; **kiểm chứng:** không có task finance/full POS/production bị đưa vào MVP mà không có change request.

## P00-T03 — ADR lõi và spike kỹ thuật

- [x] Đóng D01 gateway bằng route OIDC/public/M2M demo; ghi APISIX/etcd mode hoặc phương án thay thế, pin version/license/RAM.
- [x] Đóng D02 storage bằng upload/download private, presigned URL, backup/source build; kiểm tra tình trạng phân phối MinIO nếu chọn nó.
- [x] Đóng D03 database adapter/migration bằng spike một transaction ghi hai repository + outbox và rollback; D04 session/Next docs; D06 Flowable OSS REST + PG.
- [x] D07 decimal/lot, D08 envelope, D10 H-P-D-I, D11/D12 nguyên lý/GitOps, D14 movement ownership và D15 runtime lõi/tầng 2 có ADR có test chấp nhận.
- **Đầu ra:** ADR trong `decision-log.md` hoặc `documents/adr/`; **kiểm chứng:** không còn “TBD” chặn migration, auth hoặc transport của P01–04.

**Bằng chứng P00-T01–T03:** [baseline](./evidence/baseline.md), [scope v1](./scope-v1.md), [decision log/ADR](./decision-log.md), [spike hạ tầng](./evidence/spikes/infra/README.md), [spike PG semantics](./evidence/spikes/d03/README.md), [Prisma SoT spike](./evidence/spike-d03.md). **D03 chốt Prisma** (`0003-database-prisma.md`); ADR/`pg` superseded. Dấu tick T03 = quyết định + spike P00; Core Data/File API sản phẩm, auth production, scanner và G00 vẫn chưa đạt. T02 còn chờ BTC.

## P00-T04 — Quyền phát hành AGPL và tiêu chí nguồn mở

- [x] SPDX `AGPL-3.0-only` trên source nhóm viết + `LICENSE` toàn văn; `npm run check:spdx`.
- [x] Inventory license top-level + image PG pin (`evidence/license-inventory.md`); secret `.env*` gitignored.
- [x] Public repo/issue tracker URL ghi trong `evidence/open-source-checklist.md`; release/PoF đầy đủ vẫn P13.
- **Đầu ra:** license inventory và checklist nguồn mở; **kiểm chứng:** script quét SPDX fail nếu thiếu.

## P00-T05 — Chốt contract nghiệp vụ và dữ liệu

- [x] Khóa blueprint DB/API/event/workflow v1 và generator OpenAPI; D07/D08/D14 được đối chiếu với một owner stock movement, issuer-qualified lot, technical ACK riêng business receipt, public allowlist.
- [x] `npm run test:contracts` kiểm OpenAPI 70 paths/87 operations bằng Redocly + ma trận auth/role/scope/success/header; 30 cặp request fixtures, 4 core payload, 7 domain event, chuỗi federation A→B→C và 9 negative/3 retry/hash vectors. Xem `evidence/contract-validate.md`.
- [ ] Test gọi API/consumer đang chạy cho từng route, 401/403/409, rollback/concurrency và cross-instance; các phase P01+ và P09 phải thêm theo owner của route/event trước khi claim AC tương ứng.
- **Đầu ra P00:** contract v1 parse/validate và static fixtures pass; **kiểm chứng:** `npm test` gồm contracts, không đồng nghĩa sản phẩm đã chạy.

## P00-T06 — Chuẩn hóa repo/CI nền

- [x] Mapping scaffold: `evidence/scaffold-mapping.md`.
- [x] CI `.github/workflows/ci.yml`: install, SPDX, lint, prisma generate, build, typecheck, test.
- [x] `.env.example` (root + deploy) không secret.
- **Đầu ra:** pipeline trên clone sạch; **kiểm chứng:** thiếu SPDX / fixture sai → đỏ.

## P00-T07 — Gate G00

- [ ] Hai người review và ký `evidence/G00.md` (Status hiện **READY FOR REVIEW**).
- [x] Gói kỹ thuật: ADR promote D01/D02/D04/D06/D15 + Prisma D03; CI; SPDX; contracts; không claim M01–M04 Done.
- **Bằng chứng:** `evidence/G00.md`, ADR, baseline, scope, license inventory, contract-validate.

## Hồ sơ giao AI theo từng task

Đọc `implementation-baseline.md` trước khi giao các task. Các path là đầu ra đích, chưa có trong scaffold.

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P00-T01 | `documents/phase-plan/evidence/baseline.md` ghi commit, Node/npm/Docker version, file tree, `package.json`, route/migration/Compose hiện hữu, code legacy; log `npm ci`, `npm run lint`, `npm run build`, `docker compose -f deploy/docker-compose.yml config`. | Báo đúng migration 0 byte, Compose chỉ PG, health tĩnh, không gắn dấu Done cho M01–M04. Không sửa source trong task kiểm kê. |
| P00-T02 | `documents/phase-plan/scope-v1.md`: từng AC-01…13, yêu cầu đề thi §3–4, ngoài MVP, hành trình A→B→C theo `demo-fixtures.md`; ghi mốc nộp do BTC xác nhận hoặc blocker có owner. | Reviewer đối chiếu `test-matrix.md`/`contest-scorecard.md`; không có finance/POS/production lọt MVP. |
| P00-T03 | `documents/adr/0001-*.md`… cho D01–D15; spike mini Compose APISIX↔Keycloak, SeaweedFS upload/restore, PG/`prisma.$transaction` rollback, Flowable task, core API không UI. Ghi image tag/digest/license/RAM. | Mỗi ADR có phương án, phép thử, kết quả, quyết định và ảnh hưởng contract; D03 = Prisma Client + Migrate (xem `prisma-migration-spec.md`), D07 numeric(20,3) hoặc sửa blueprint khi spike bác bỏ. |
| P00-T04 | `LICENSE`, SPDX inventory từng source file, `NOTICE` nếu cần, `CHANGELOG.md`, public repo/issue tracker URL, secret/license scan config. | Mỗi tệp mã do nhóm viết có SPDX; full AGPL text; dependency/tài sản có provenance; không commit secret. |
| P00-T05 | `database-schema-v1.md`, `api-payloads-v1.md`, `event-payloads-v1.md`, `workflow-spec-v1.md` chốt version 1; tạo `contracts/openapi/`, `contracts/events/` với schema/fixtures A→B. | AC và ADR đồng nhất: một owner stock movement, issuer-qualified lot, technical ACK≠receiving, public allowlist; contract parse/validate pass. |
| P00-T06 | `.github/workflows/ci.yml`, scripts `typecheck/test/db:migrate` trong `package.json`, `deploy/.env.example`, mapping scaffold cũ→contexts đích. | CI chạy trên clone sạch; cố ý sai lint/typecheck thì fail; script `test` không giả xanh khi suite chưa có. |
| P00-T07 | `evidence/G00.md` gồm ADR links, output baseline/CI, contract version, reviewer và open risks. | Hai người review; mọi D01–D08/D14/D15 chặn P01–04 đã đóng hoặc gate ghi fail, không đẩy dependency giả. |

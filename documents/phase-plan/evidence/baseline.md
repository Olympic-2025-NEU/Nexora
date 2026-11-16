# P00-T01 — Baseline kiểm kê từ clone sạch

Ngày đo: 2026-11-16 (Asia/Saigon). Nguồn: nhánh phase-00/baseline-t03 tại commit 37f532d4527e8efcf989b7818f21f3c4d1f3d2e8. Trước khi đo, git status trên checkout nguồn là sạch; main và origin/main cùng commit. Các lệnh npm/build/Compose được chạy trong **clone tạm độc lập** của chính commit này, không dùng node_modules hay file .env có sẵn của người viết.

## 1. Môi trường và lệnh tái tạo

| Công cụ | Phiên bản quan sát |
| --- | --- |
| Node.js | v24.18.0 |
| npm | 12.0.0 |
| Git for Windows | 2.45.1.windows.1 |
| Docker CLI/Server | 29.6.1 / 29.6.1 |
| Docker Compose | v5.3.0 |
| Next/React/Tailwind trong package.json | 16.4.6 / 19.3.0 / 4.3.3 |
| TypeScript được npm ci cài | 5.9.3 |

Lệnh tái tạo trên PowerShell với bản clone sạch:

~~~powershell
git clone https://github.com/Olympic-2025-NEU/Nexora.git Nexora-baseline
Set-Location Nexora-baseline
git checkout 37f532d4527e8efcf989b7818f21f3c4d1f3d2e8
git status --short --branch
node --version
npm --version
docker --version
docker compose version
npm ci
npm run lint
npx tsc --noEmit
npm run build
npx tsc --noEmit
docker compose -f deploy/docker-compose.yml config
Copy-Item -LiteralPath deploy/.env.example -Destination deploy/.env
docker compose -f deploy/docker-compose.yml config -q
~~~

Lệnh config đầu tiên cố ý chạy **trước** khi chép env để ghi nhận lỗi clean clone. Không chạy docker compose up; phần này chỉ xác nhận cú pháp Compose, chưa chứng minh PostgreSQL hoặc dịch vụ lõi hoạt động. Clone tạm và file env ví dụ chỉ nằm ngoài repo nguồn.

## 2. Snapshot mã và runtime thực có

- Git theo dõi 108 file; package-lock.json là lockfile v3 với 432 package entries. package.json chỉ có script dev, build, start, lint. Không có script typecheck, test, migration hoặc integration/e2e.
- app chỉ có trang chủ Create Next App và route GET /api/v1/health. Build liệt kê ba route /, /_not-found, /api/v1/health; health được prerender static. Nội dung route trả status ok cộng tên module từ platform/modules.ts; không probe PG, Keycloak, gateway, storage, Flowable hoặc worker.
- deploy/docker-compose.yml chỉ khai báo PostgreSQL image postgres:17, volume và port host 5432:5432; không có app, gateway, Keycloak, Flowable, Redis, scanner hay object storage. Image chỉ pin major tag, chưa có digest. deploy/.env.example có giá trị placeholder; deploy/.env không nằm trong Git.
- db/migrations/0001_platform.sql có **0 byte**; mount qua docker-entrypoint-initdb.d chỉ có hiệu lực khi khởi tạo volume mới. Chưa có migration runner hoặc bảng ứng dụng.
- platform/ chứa type/interface, mảng tên pipeline, applyAction state guard và mô tả port; chưa có adapter DB/OIDC/Flowable/S3 hoặc worker. Transaction.run hiện nhận callback không có PoolClient. platform/modules.ts liệt kê tên context cũ; tên trong health không chứng minh triển khai.
- composition/context-map.ts và contexts/sales, procurement, finance, master-data là scaffold lệch Chương 6, không phát triển tiếp. contexts/inventory hiện chỉ có reservation thuộc scaffold cũ; chưa có catalog, system, trading, traceability hoặc federation context. services/core-data, services/ai, apps/dx-lab, workers, contracts và tests chưa tồn tại.
- Không có file test/spec thực thi hoặc workflow CI trong .github/workflows. Tài liệu test-matrix và phase-plan là kế hoạch, không phải kết quả test.

## 3. Nguồn gốc mã và tài sản cần rà quyền

| Nhóm | File/nguồn quan sát | Kết luận kiểm kê |
| --- | --- | --- |
| Create Next App template | app/page.tsx, app/layout.tsx, app/globals.css, eslint.config.mjs, next.config.ts; commit khởi tạo 45097d6 mang tên Initial commit from Create Next App | Trang chủ, metadata và style còn mặc định. Xác minh điều khoản/notice của template trước khi phân phối; không gắn nhầm là nghiệp vụ Nexora. |
| Tài sản template | public/file.svg, globe.svg, next.svg, vercel.svg, window.svg và app/favicon.ico (15,086 bytes), cùng commit 45097d6 | Không có ảnh sản phẩm/brand riêng; logo Next/Vercel còn hiện. Cần kiểm provenance/notice ở P00-T04 hoặc thay bằng tài sản có quyền sử dụng. |
| Font | app/layout.tsx import Geist và Geist_Mono qua next/font/google; không có font binary được Git theo dõi | Tệp font và quyền phân phối của bản build cần ghi trong inventory P00-T04. |
| Scaffold Nexora | app/api/v1/health/route.ts, components/shell, composition, contexts/*, platform/* được thêm chủ yếu ở commit 5e5d617 | Đây là code khung chứ chưa phải chức năng M01–M04. Tác giả/quyền cấp phép mã nhóm cần nhóm xác nhận ở P00-T04. |
| Dependency | package.json/package-lock.json, npm ci cài 357 packages và audit 358 | Giấy phép/SBOM và nguồn phân phối từng dependency thuộc P00-T04/D13; không suy từ license của package gốc sang tất cả dependency. |

Quét 33 file mã được Git theo dõi với đuôi .ts/.tsx/.css/.mjs: **33/33 chưa chứa SPDX-License-Identifier**. Đây là danh mục cần phân loại template/nhóm viết và xử lý ở P00-T04, chưa tự ý thêm header vào tài sản bên thứ ba. Các SVG/favicon cũng chưa có provenance/notice riêng trong repo; lịch sử commit chỉ chứng minh chúng có mặt từ scaffold, không chứng minh quyền phân phối.

**Danh mục mã để P00-T04 đối chiếu quyền:** 5 tệp xuất hiện từ commit Create Next App: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `eslint.config.mjs`, `next.config.ts`. Còn 28 tệp scaffold Nexora cần nhóm xác nhận tác giả/quyền cấp phép trước khi thêm SPDX:

```text
app/api/v1/health/route.ts
components/shell/areas.ts
composition/context-map.ts
contexts/finance/domain/invoice.ts
contexts/finance/index.ts
contexts/inventory/domain/reservation.ts
contexts/inventory/index.ts
contexts/master-data/domain/item.ts
contexts/master-data/domain/partner.ts
contexts/master-data/index.ts
contexts/procurement/domain/purchase-order.ts
contexts/procurement/index.ts
contexts/sales/application/ports.ts
contexts/sales/domain/sales-order.ts
contexts/sales/index.ts
platform/access/scope.ts
platform/audit/audit-recorder.ts
platform/files/file-store.ts
platform/http/pipeline.ts
platform/identity/actor.ts
platform/index.ts
platform/kernel/errors.ts
platform/kernel/id.ts
platform/modules.ts
platform/outbox/message.ts
platform/persistence/transaction.ts
platform/tenancy/tenant.ts
platform/workflow/process.ts
```

Danh mục này là phân loại theo lịch sử Git, **không phải** xác nhận pháp lý về tác giả hoặc quyền cấp phép. P00-T04 phải xác minh từng trường hợp với nhóm và giữ notice của tài sản bên thứ ba.

## 4. Kết quả lệnh baseline

| Lệnh | Kết quả quan sát |
| --- | --- |
| npm ci | Exit 0, cài 357 packages trong khoảng 1 phút. npm cảnh báo ESLint 9.39.5 deprecated và 7 lỗ hổng mức moderate. |
| npm run lint | Exit 0. |
| npx tsc --noEmit **trước build** | Exit 1: app/layout.tsx:20:50, TS2304 Cannot find name LayoutProps. Type này do Next tạo sau build; script typecheck sạch từ clone hiện chưa có. |
| npm run build | Exit 0; Next 16.4.6 compile, TypeScript và static generation thành công. Điều này chỉ xác nhận scaffold build được. |
| npx tsc --noEmit **sau build** | Exit 0 nhờ .next/types đã được sinh. |
| docker compose -f deploy/docker-compose.yml config **trước env** | Exit 1: thiếu deploy/.env. |
| Copy-Item env example rồi docker compose ... config -q | Exit 0, chỉ xác nhận config parse được với placeholder. |
| npm audit --json | 7 moderate, 0 high/critical; các package được báo đều là dependency gián tiếp ở chuỗi typescript-eslint/minimatch. |
| npm audit --omit=dev --json | 0 vulnerability ở production dependency tại thời điểm đo. |

Sau các lệnh, clone tạm vẫn git status sạch; output build/node_modules và .env ví dụ đều được ignore. Không chạy test nghiệp vụ vì không có test suite/script; không khởi động database hoặc lõi.

## 5. Gap register để tạo issue/PR theo phase

| ID | Hiện trạng và bằng chứng | Đầu việc/owner phase |
| --- | --- | --- |
| P00-GAP-01 | Chưa có gateway, SSO, core data/file API, Flowable và DX-Lab runtime; Compose chỉ PG. | P00-T03 chọn/spike D01/D02/D04/D06/D15; P01–P04 hiện thực; P11 UI. |
| P00-GAP-02 | Chỉ có scaffold sales/procurement/finance/master-data và reservation cũ, chưa có M01–M04. | P00-T06 lập mapping giữ/chuyển/xóa; P05–P09 xây module. |
| P00-GAP-03 | Health static, không kiểm dependency. | P01-T06 health live/ready và smoke; P02 gate bảo vệ route. |
| P00-GAP-04 | Migration 0001 dài 0 byte, không có runner/version và PG port 5432 publish host. | P01-T01/T03 thay Compose/migration, DB role/network và thử restart. |
| P00-GAP-05 | Không có CI/test/typecheck script; tsc sạch trước build lỗi LayoutProps. | P00-T06 thêm thứ tự typegen/typecheck, CI và test command không giả xanh. |
| P00-GAP-06 | 33/33 file mã thiếu SPDX; template assets/font chưa có provenance được xác minh. | P00-T04 xác nhận quyền và phân loại; giữ notice bên thứ ba, thêm SPDX cho mã nhóm. |
| P00-GAP-07 | npm audit báo 7 moderate ở dev dependency, production audit 0 tại ngày đo. | P00-T04/T06 kiểm advisories + lockfile, cập nhật có test thay vì npm audit fix mù. |
| P00-GAP-08 | Không có federation A/B/C hoặc nghiệp vụ chứng từ; health liệt kê tên module cũ dễ tạo claim sai. | P00-T02 chốt phạm vi; P05–P09 triển khai; P13 E2E. |

Tất cả gap ở bảng là **chưa hoàn thành**. Repo đã có các issue triển khai; mapping dưới đây dùng issue có sẵn để tránh tạo ticket trùng. Một issue có thể theo dõi nhiều gap và các nội dung cũ phải được đối chiếu với ADR mới trước khi giao AI. Chưa có người nhận việc được chỉ định cho mọi issue; nhóm gắn assignee theo năng lực.

| Gap | GitHub issue theo dõi |
| --- | --- |
| P00-GAP-01 | [#42 gateway](https://github.com/Olympic-2025-NEU/Nexora/issues/42), [#34 identity](https://github.com/Olympic-2025-NEU/Nexora/issues/34), [#35 workflow](https://github.com/Olympic-2025-NEU/Nexora/issues/35), [#36 file/audit](https://github.com/Olympic-2025-NEU/Nexora/issues/36), [#43 DX-Lab](https://github.com/Olympic-2025-NEU/Nexora/issues/43) |
| P00-GAP-02 | [#2 system](https://github.com/Olympic-2025-NEU/Nexora/issues/2), [#3 product/inventory](https://github.com/Olympic-2025-NEU/Nexora/issues/3), [#4 trading](https://github.com/Olympic-2025-NEU/Nexora/issues/4), [#5 trace/federation](https://github.com/Olympic-2025-NEU/Nexora/issues/5), [#6 AI](https://github.com/Olympic-2025-NEU/Nexora/issues/6) |
| P00-GAP-03 | [#37 deployment/health](https://github.com/Olympic-2025-NEU/Nexora/issues/37) |
| P00-GAP-04 | [#33 PostgreSQL/migrations](https://github.com/Olympic-2025-NEU/Nexora/issues/33) |
| P00-GAP-05 | [#39 tests/CI](https://github.com/Olympic-2025-NEU/Nexora/issues/39) |
| P00-GAP-06 | [#40 license/documentation](https://github.com/Olympic-2025-NEU/Nexora/issues/40) |
| P00-GAP-07 | [#40 dependency/license inventory](https://github.com/Olympic-2025-NEU/Nexora/issues/40) |
| P00-GAP-08 | [#26 event exchange](https://github.com/Olympic-2025-NEU/Nexora/issues/26), [#27 partner auth/mapping](https://github.com/Olympic-2025-NEU/Nexora/issues/27), [#38 A→B→C E2E](https://github.com/Olympic-2025-NEU/Nexora/issues/38) |

Kết quả kiểm kê này không đánh dấu P00-T01 hoặc G00 Done thay reviewer.

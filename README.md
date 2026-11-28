# Nexora

**Nền tảng ERP nguồn mở tích hợp truy xuất nguồn gốc và liên thông chuỗi cung ứng theo kiến trúc phân tán.**

Nexora được thiết kế để giúp doanh nghiệp quản lý sản phẩm, lô hàng, tồn kho và chứng từ nhập–xuất–chuyển giao trên hạ tầng tự vận hành (self-hosted), đồng thời trao đổi sự kiện truy xuất với đối tác qua API federation — mỗi bên giữ database riêng, không phụ thuộc một nền tảng SaaS tập trung.

Trong MVP đích, người tiêu dùng sẽ tra cứu nguồn gốc được phép công bố qua mã QR / Product Passport. AI sẽ hỗ trợ tra cứu và tạo chứng từ dự thảo; xác nhận nghiệp vụ vẫn do con người thực hiện.

> Ràng buộc dự thi lấy theo đề thi/thể lệ OLP PMNM 2026. Phạm vi chức năng MVP lấy theo **Chương 6** đề xuất; tech stack Nexora lấy theo **Chương 7 §7.12**. Đây là kiến trúc đích, chưa phải danh sách tính năng đã chạy.

## Vì sao Nexora

| Vấn đề | Cách Nexora tiếp cận |
| --- | --- |
| Dữ liệu lô/hàng phân tán giữa nhiều doanh nghiệp | Mỗi tổ chức một instance; liên thông bằng sự kiện có xác thực |
| Truy xuất tách rời ERP | Sự kiện truy xuất phát sinh khi confirm chứng từ nghiệp vụ |
| Phụ thuộc SaaS / khó tùy biến | Open-source, self-hosted, Modular Monolith + DDD |
| Thiếu dấu vết trách nhiệm | Audit, outbox, trạng thái chứng từ chỉ đổi qua hành động |

## Phạm vi MVP

### Module nghiệp vụ

| Mã | Module | Nội dung chính |
| --- | --- | --- |
| Platform | DX-OS headless + adapter dùng chung | SSO, API Gateway, dữ liệu cấu trúc/phi cấu trúc, Workflow; quyền, audit, outbox |
| M01 | System & Partner | Hồ sơ doanh nghiệp, user, đối tác, kết nối instance |
| M02 | Product & Inventory | Sản phẩm, SKU/barcode, lô, kho, tồn, lịch sử biến động |
| M03 | Trading & Distribution | Phiếu nhập/xuất, chuyển giao, xác nhận nhận hàng, kiểm kê, ghi nhận bán theo lô |
| M04 | Traceability & Federation | Sự kiện truy xuất, QR/Passport, exchange/ack/retry/dedupe |
| AI01 | AI Support | Tra cứu lô/truy xuất, tạo draft chứng từ, cảnh báo theo quy tắc |

Thứ tự phụ thuộc: **Platform → M01 → M02 → M03 → M04 → AI01**. Chi tiết: [documents/plans/DEPENDENCIES.md](./documents/plans/DEPENDENCIES.md).

### Kịch bản demo trọng tâm

Ba instance độc lập:

1. **A (nhà cung cấp)** — tạo sản phẩm/lô, xuất hàng cho B  
2. **B (nhà phân phối)** — nhận hàng, xuất một phần cho C  
3. **C (bán lẻ)** — nhận hàng, ghi nhận bán theo lô, phát hành QR  

### Ngoài MVP

Kế toán/công nợ, CRM, POS đầy đủ, sản xuất/BOM, QC nhiều bước, thu hồi đa cấp, Workflow Builder tổng quát, SaaS multi-tenant trên một database.

## Kiến trúc ngắn

- **Self-hosted, single-tenant theo instance:** một doanh nghiệp = một bản cài = một PostgreSQL.
- **Modular Monolith (Next.js):** UI App Router + API Route Handlers trong cùng ứng dụng.
- **Lõi DX-OS headless:** SSO, API Gateway, core data/file API không UI, dữ liệu và Workflow cung cấp dịch vụ qua API cho ứng dụng; DX-Lab H-P-D-I là frontend tầng 2 triển khai riêng.
- **DDD:** nghiệp vụ trong `contexts/`; ports/adapters dùng chung trong `platform/`; AI trong `services/ai/`.
- **Confirm chứng từ:** một giao dịch ghi aggregate + tồn (qua port Inventory) + outbox + audit.
- **Federation:** nhận message kỹ thuật ≠ đã nhận đủ hàng (cần Receiving Confirmation).

Chi tiết: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Tech stack đích

| Lớp | Công nghệ |
| --- | --- |
| Giao diện | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Biên & định danh | API Gateway nguồn mở, Keycloak (OIDC/SSO), HTTPS |
| Nghiệp vụ & dữ liệu | Next.js Modular Monolith, DDD, PostgreSQL |
| Quy trình & CI/CD | Flowable, GitHub Actions, Docker Compose |
| Hàng đợi & tệp | Redis, object storage tương thích S3; ưu tiên tự host cho demo |
| AI | Python, REST, LLM (tool-calling qua API đã phân quyền) |
| Quan sát | OpenAPI, Prometheus, Grafana |

## Cấu trúc thư mục (đích)

```text
nexora/
  apps/dx-lab/          # Ứng dụng H-P-D-I tầng 2 (đích)
  app/                  # UI + API adapters
  platform/             # Ports/adapters tích hợp lõi DX-OS headless
  contexts/             # M01–M04 (system, catalog, inventory, trading, …)
  services/core-data/   # API dữ liệu/tệp headless (đích)
  services/ai/          # AI01
  composition/          # Wire ports giữa contexts
  prisma/               # Prisma schema + Migrate (D03)
  deploy/               # compose.yml, instances A/B/C, APISIX stubs
  documents/
    referents/          # Luật & nguồn chân lý cho Agent/DevOps
    plans/              # Plan tổng quan theo module
    phase-plan/         # Task chi tiết theo phase, gate và test matrix
    nexora/             # Đề xuất dự án
```

Luật import và schema: [documents/referents/FOLDER_STRUCTURE.md](./documents/referents/FOLDER_STRUCTURE.md).

## Tài liệu

| Tài liệu | Mục đích |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Kiến trúc tổng thể |
| [AGENTS.md](./AGENTS.md) | Hướng dẫn AI Agent khi code |
| [CHANGELOG.md](./CHANGELOG.md) | Lịch sử thay đổi và trạng thái release |
| [documents/referents/](./documents/referents/) | Nguồn chân lý, catalog module, coding rules, glossary, AC |
| [documents/referents/OLP_2026_ALIGNMENT.md](./documents/referents/OLP_2026_ALIGNMENT.md) | Ràng buộc đề thi và hiện trạng chưa triển khai |
| [documents/plans/](./documents/plans/) | Plan triển khai từng module |
| [documents/phase-plan/](./documents/phase-plan/) | Kế hoạch thực thi chi tiết Phase 00–13, contract, fixture và gate nghiệm thu |
| [documents/nexora/Nexora - NEU.OPUS5.5.md](./documents/nexora/Nexora%20-%20NEU.OPUS5.5.md) | Đề xuất đầy đủ (Chương 6 = MVP, Chương 7 = kiến trúc/stack) |
| [.cursor/rules/](./.cursor/rules/) · [.cursor/skills/](./.cursor/skills/) | Rules & skills cho Cursor Agent |

Tiêu chí nghiệm thu MVP (AC-01…AC-13): [documents/referents/ACCEPTANCE_MVP.md](./documents/referents/ACCEPTANCE_MVP.md).

## Bắt đầu nhanh (clean install)

Hướng dẫn này giả định máy/VM **không** có secret của tác giả, không dùng registry private, và chạy container bằng Compose với project name độc lập (không phụ thuộc đường dẫn checkout máy người viết). Chi tiết đầy đủ: [deploy/README.md](./deploy/README.md).

### Yêu cầu

| Thành phần | Ghi chú |
| --- | --- |
| Node.js | LTS tương thích Next.js 16 (đã thử Node 22 / 24 trên máy demo) |
| npm | Đi kèm Node; **chỉ** `npm ci` từ `package-lock.json` |
| Docker Engine + Compose v2 | Build image từ Dockerfile trong repo; không cần image private |
| RAM trống khuyến nghị | ≥ **8 GiB** free cho một instance A + apps; ≥ **12 GiB** nếu cố A+B+C song song. Máy demo hẹp (~1.5–2 GiB free với A) → chỉ một stack / tắt profile thừa |
| Ổ đĩa | ≥ **20 GiB** trống (image build + ClamAV signatures) |

### Linux / macOS (Bash)

```bash
git clone --branch phase-13 https://github.com/Olympic-2025-NEU/Nexora.git Nexora-clean
cd Nexora-clean/nexora   # hoặc thư mục chứa package.json nếu monorepo layout khác
npm ci
bash deploy/scripts/bootstrap.sh a
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps config -q
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build
bash deploy/scripts/smoke.sh a nexora-a
# optional seed (dev fixtures): bash deploy/scripts/seed.sh a nexora-a
```

### Windows (PowerShell)

```powershell
git clone --branch phase-13 https://github.com/Olympic-2025-NEU/Nexora.git Nexora-clean
cd Nexora-clean\nexora
npm ci
./deploy/scripts/bootstrap.ps1 a
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps config -q
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build
bash deploy/scripts/smoke.sh a nexora-a   # Git Bash / WSL; or use Docker Desktop bash
```

`bootstrap` tạo `deploy/instances/a.env` từ `a.env.example`, điền `CHANGE_ME_*`, **không** cần file secret có sẵn trên laptop tác giả. Migration chạy qua service `db-migrate` trước ERP. Không commit `.env`. Instance B/C: thay `a` → `b`/`c` và cổng trong env example (B gateway `19081`).

**Chạy ngoài path máy tác giả:** dùng `-p nexora-a` (hoặc tên project bất kỳ) và checkout vào thư mục mới (`Nexora-clean`). Volume/network gắn theo project name, không hard-code `E:\Working\…`.

### Chỉ UI scaffold (không Compose)

```bash
npm ci
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

### Lỗi thường gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| Port `19080` đã chiếm | Đổi `GATEWAY_HTTP_PORT` / `PUBLIC_BASE_URL` / OIDC redirect trong `a.env`, rồi `bootstrap` validate lại |
| OOM / Docker kill khi build hoặc up A+B+C | Chỉ một instance; bỏ `--profile dxlab`/`ai` nếu cần; xem [known-limitations.md](./documents/phase-plan/evidence/known-limitations.md) |
| `docker compose` unknown | Cài Compose plugin; fallback CLI image trong [deploy/README.md](./deploy/README.md) |
| Smoke fail khi service còn starting | Đợi healthy rồi chạy lại `smoke.sh` |
| Muốn reset an toàn | `docker compose … down` (giữ volume) hoặc theo [backup-restore.md](./deploy/backup-restore.md); không xóa volume production |

### Scripts

| Lệnh | Việc |
| --- | --- |
| `npm ci` | Cài đúng lockfile |
| `npm run dev` / `build` / `start` / `lint` | Dev / production / lint |
| `npm test` | Gate unit/contract/security checks (không thay smoke Compose) |

## Trạng thái hiện tại

Stack Compose (PostgreSQL, Keycloak, APISIX, Flowable, SeaweedFS, ERP, core-data, worker, DX-Lab, AI stub) và nghiệp vụ MVP theo phase-plan đã có trên nhánh release `phase-13`. Gate và khoảng trống trung thực: [evidence/known-limitations.md](./documents/phase-plan/evidence/known-limitations.md), [phase-plan](./documents/phase-plan/README.md).

## Giấy phép

Dự án áp dụng **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`); xem [LICENSE](./LICENSE) và [NOTICE](./NOTICE). `package.json` khai báo `"license": "AGPL-3.0-only"`. `private: true` chỉ ngăn phát hành gói npm, không xác nhận quyền truy cập công khai của kho Git.

**Source offer (AGPL network use):** mã nguồn tương ứng phiên bản đang chạy được cung cấp tại [https://github.com/Olympic-2025-NEU/Nexora](https://github.com/Olympic-2025-NEU/Nexora) (clone nhánh/tag trùng commit deploy), kèm `LICENSE`, `NOTICE`, và inventory SPDX/npm trong `documents/phase-plan/evidence/`. SPDX trên mã tự viết và inventory third-party được kiểm bằng `npm run check:spdx` và `npm run check:licenses`.

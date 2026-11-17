# D13 — Phiên bản, giấy phép và tài nguyên thử nghiệm

- Ngày: 2026-11-17. Trạng thái: **pin ứng viên cho P01–P04**; SBOM/license transitive, notice, nguồn gốc asset và reviewer G00/P00-T04 còn mở.
- Câu hỏi: thành phần nào đã có tag/digest/source/license và mức RAM quan sát để tránh mỗi task AI tự chọn bản khác?
- Quyết định: dùng đúng digest dưới đây cho spike/baseline kỹ thuật; cập nhật bằng ADR khi đổi. Project source vẫn `AGPL-3.0-only`; giấy phép thành phần chạy kèm không tự đổi giấy phép source Nexora. Chưa kết luận tương thích pháp lý của **toàn bộ** bản phân phối khi chưa rà artifact/notice/transitive dependency.

| Thành phần | Pin image tại ngày thử | Source/license chính | RAM snapshot `docker stats --no-stream` |
| --- | --- | --- | --- |
| APISIX 3.20.0 | `apache/apisix@sha256:013de62a9dfba7d8e6006b3e85b524c28c9f1c3549fca3b91d5b258b0b9e759a` | [Apache-2.0](https://github.com/apache/apisix/blob/3.20.0/LICENSE) | 358.3 MiB |
| Keycloak 26.8.2 | `quay.io/keycloak/keycloak@sha256:c68e286cacd87b942ac1939a0a1481461109d6acd3a57dc496969a319a76bbf0` | [Apache-2.0](https://github.com/keycloak/keycloak/blob/main/LICENSE.txt) | 944.7 MiB |
| SeaweedFS 4.53 | `chrislusf/seaweedfs@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0` | [Apache-2.0](https://github.com/seaweedfs/seaweedfs/blob/4.53/LICENSE), source build D02 | 152.7 MiB |
| Flowable REST 8.0.0 | `flowable/flowable-rest@sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d` | [Apache-2.0](https://github.com/flowable/flowable-engine/blob/flowable-8.0.0/LICENSE) | 316.9 MiB |
| PostgreSQL 17 (spike major) | `postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` | [PostgreSQL License](https://www.postgresql.org/about/licence/) | 70.36 MiB cho Flowable DB; D03 scratch riêng |
| PostgreSQL 17.6 (**P01 Compose**) | `postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` | PostgreSQL License | D03 spike idle ~37 MiB; peak chưa đo full stack |
| Redis 7.4-alpine (**P01 Compose**) | `redis:7.4-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe` | [BSD-3-Clause](https://github.com/redis/redis/blob/7.4/COPYING) | Chưa đo peak; limit Compose 256 MiB |
| ClamAV 1.4 (**P01 Compose**) | `clamav/clamav:1.4@sha256:4cc4350d3fded380caf1799e76c0d1c93f3fa40af99c0cb2862ec0c9b117718a` (`platform: linux/amd64`) | [GPL-2.0-only](https://github.com/Cisco-Talos/clamav/blob/main/COPYING.txt) — review redistribution | Chưa đo peak; limit Compose 2 GiB |
| Python 3.12-slim (upstream giả) | `python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea` | Chỉ dùng test gateway, **không** là runtime Nexora | 14.04 MiB |
| Core headless spike | Build local từ Python base digest trên; `requirements-core.txt` pin psycopg/PyJWT và phụ thuộc Python | Mã scratch [core_spike.py](../phase-plan/evidence/spikes/infra/core_spike.py) AGPL-3.0-only; không là Core API sản phẩm | 27.68 MiB; core PG riêng 58.99 MiB |

P01 application pins are also listed in [`deploy/README.md`](../../deploy/README.md) and [`evidence/license-inventory.md`](../phase-plan/evidence/license-inventory.md).

Docker Engine 29.6.1, Linux VM báo 11.55 GiB. Số RAM là một snapshot idle sau khi khởi động trên máy có container khác; không là peak, không suy đủ RAM cho ba stack A/B/C, AI, scanner, k3s/Argo CD. P01/P09/P12 phải đo peak/CPU/disk khi full demo và failure/restart. Flowable/Keycloak có JVM nên nhu cầu thực có thể khác nhiều.

Thử Go build SeaweedFS không giới hạn cùng lúc với stack spike đã làm Docker Engine reset (`unexpected EOF`, các container spike exit 255). Lần chạy lại **cô lập**, container giới hạn 6 GiB và `go build -p 2`, exit 0. Vì vậy không chạy source build/CI nặng đồng thời với demo trên máy này khi chưa có đo tài nguyên; kết quả này không là phép đo full stack A/B/C.

`package.json`/lockfile app ở commit baseline có Next 16.4.6, React 19.3.0, Tailwind 4.3.3 và TypeScript cài ra 5.9.3; `pg@8.23.1` chỉ ở lockfile [spike D03](../phase-plan/evidence/spikes/d03/README.md), chưa là dependency app. P00-T04 phải tạo inventory/SBOM cho npm lockfile, image layers, font/SVG/template, license/NOTICE của model và SDK, xác nhận quyền mã nhóm, scan secret và 7 moderate dev advisories trong baseline. D02 build từ source chỉ chứng minh SeaweedFS binary tạo được, không thay inventory transitive hoặc build test của APISIX/Keycloak/Flowable. Không công bố release AGPL/PoF đã đạt từ bảng này.

# Phase 01 — Runtime lõi và cài đặt lại từ source

**Mục tiêu:** một instance dev có các tiến trình cần cho lõi headless và app, từ clone sạch, không bí mật trong Git. **Phụ thuộc:** G00. **Unblock:** P02/P03. Đây mới là hạ tầng sống, chưa tính đã hoàn tất SSO/Workflow.

## P01-T01 — Topology Compose và mạng

- [x] `deploy/compose.yml`: ERP/worker/core-data (profile `apps`), DX-Lab (`dxlab`), PG, Keycloak, APISIX standalone (không etcd), Redis, SeaweedFS, Flowable, ClamAV, AI (`ai`); mạng `edge`/`internal`, volume per `INSTANCE_ID`.
- [x] Chỉ publish gateway `127.0.0.1:${GATEWAY_HTTP_PORT}`; `local-admin` publish loopback PG/Keycloak; không public Redis/Flowable/storage/etcd.
- [x] Resource limits + pinned digests trong compose; evidence `evidence/p01-t01.md` (`config -q` A/B/C PASS). `up`/inspect runtime còn lại khi Docker sẵn sàng.
- **Đầu ra:** Compose + `deploy/README.md` + `instances/{a,b,c}.env.example`; **kiểm chứng:** `config` pass; published ports chỉ gateway.

## P01-T02 — Build Next.js từ source và image app/worker

- [x] `Dockerfile` multi-stage Next 16 + `.dockerignore`; non-root user; không copy `.env`.
- [x] `services/core-data/` stub image + `/health/live`; `apps/dx-lab/` stub (P11). Chưa phải Core Data/File API sản phẩm.
- [x] `worker/entrypoint.js` stub (cùng image ERP, command khác); outbox thật = P04.
- [x] Build/run image trên clone sạch + CI image job; ghi digest runtime (`evidence/p01-t02.md`).
- **Đầu ra:** image app/worker tái lập; **kiểm chứng:** image build trong CI và run sau khi xóa cache build (không dựa máy tác giả).

## P01-T03 — PostgreSQL và migration runner

- [x] Một PG instance stack có DB/role riêng cho app, Keycloak và Flowable; cấp quyền tối thiểu. Không dùng DB `postgres` chung cho mọi service. Evidence: [evidence/p01-t03.md](evidence/p01-t03.md).
- [x] Chọn migration tool theo D03, tạo bảng version và script bootstrap; migration chạy một lần an toàn khi restart, không dựa initdb file chỉ chạy lúc volume rỗng. Evidence: [evidence/p01-t03.md](evidence/p01-t03.md).
- [x] Test từ DB trống và DB đã migrate; backup/restore bản nền; bảo vệ credential qua env/secret reference. Evidence: [evidence/p01-t03.md](evidence/p01-t03.md).
- **Đầu ra:** migration workflow; **kiểm chứng:** repeat deploy không drop dữ liệu và migration history đúng.

## P01-T04 — Bootstrap Keycloak, gateway, Flowable, storage

- [x] Keycloak realm/client import có thể lặp, tài khoản dev tạo an toàn, issuer/redirect URL cấu hình được; không commit admin password. Evidence: [evidence/p01-t04.md](evidence/p01-t04.md).
- [x] Gateway có bootstrap route health, upstream core API và Next ERP, cấu hình admin API nội bộ; Flowable REST nối DB bền vững và health; storage tạo bucket/quarantine và credential tách. Evidence: [evidence/p01-t04.md](evidence/p01-t04.md).
- [x] Kiểm tra startup ordering, crash/restart riêng từng service; không dùng H2 mặc định cho Flowable ở môi trường nghiệm thu. Evidence: [evidence/p01-t04.md](evidence/p01-t04.md).
- **Đầu ra:** service boots có persistence; **kiểm chứng:** restart container vẫn giữ realm/process test/bucket và gateway route.

## P01-T05 — Env, cấu hình và secret hygiene

- [x] `deploy/.env.example` + `instances/{a,b,c}.env.example` đánh dấu `CHANGE_ME_*`; root `.env.example` trỏ local-admin.
- [x] Tách PUBLIC_BASE_URL / OIDC / S3 / DB / Flowable / Redis theo instance; A/B/C khác port + volume name.
- [ ] Typed fail-fast parser + bootstrap scripts; secret-scan CI mở rộng (P01-T05 còn lại).
- **Đầu ra:** config matrix; **kiểm chứng:** clone mới điền env theo docs là boot được, thiếu biến trọng yếu báo lỗi rõ.

## P01-T06 — Health, logs và seed hạ tầng

- [ ] `live` phản ánh process; `ready` của **từng service** kiểm đúng dependency của nó bằng timeout (app không gọi ngược gateway gây vòng readiness). Smoke tổng hợp bên ngoài kiểm PG/gateway/Keycloak/core API/Flowable/storage; tránh trả `ok` tĩnh hoặc tiết lộ nội bộ công khai.
- [ ] Request/correlation ID qua gateway/app/worker, log JSON redacted; metrics cơ bản service up và worker queue depth (worker logic P04).
- [ ] Seed chỉ dữ liệu dev hạ tầng, idempotent; không seed user/secret production vào repo.
- **Đầu ra:** health/log baseline; **kiểm chứng:** tắt PG hoặc Flowable, readiness thay đổi có lý do và không lộ secret.

## P01-T07 — Gate G01 cài lại độc lập

- [ ] Một người khác clone từ Git, dùng chỉ README + `.env.example`, build ERP/core API images, chạy migration và Compose; ghi thời gian/lỗi thực tế.
- [ ] Dựng stack thứ hai với project name/volume/network/DB riêng; chứng minh không xung đột port/tên. Chưa cần federation.
- **Bằng chứng:** terminal log, `compose ps/config`, DB role list đã redacted, health dependency và SHA image.

## Hồ sơ giao AI theo từng task

Áp dụng `deployment-spec-v1.md`; sau P00, thay image placeholder bằng version/digest ADR đã kiểm.

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P01-T01 | Thay `deploy/docker-compose.yml` cũ bằng `deploy/compose.yml`, sửa mọi lệnh gọi trong README/scripts; thêm `deploy/instances/{a,b,c}.env.example`, `deploy/README.md`; service matrix trong `deployment-spec-v1.md`, `edge/internal` networks và volume per project. | Chỉ một Compose entrypoint; `docker compose ... config` cho A/B/C pass; inspect không thấy PG/Redis/Flowable/etcd/storage admin public; mỗi project name/port khác nhau. |
| P01-T02 | `Dockerfile` ERP, `services/core-data/Dockerfile`, worker entrypoint, `.dockerignore`; `package.json` script build cả hai. | `npm ci && npm run build` và image build từ checkout sạch; container non-root, image không chứa `.env`/host `node_modules`; worker chạy khi web process tắt. |
| P01-T03 | Thay `db/migrations/0001_platform.sql` rỗng bằng **Prisma Migrate** đầu (`prisma/migrations/…`) tạo `audit_log/attachment/core_record` theo schema v1 + `prisma-migration-spec.md`; singleton client; DB bootstrap roles `app_runtime/core_data/keycloak/flowable/migrator`; không dựa initdb mount rỗng; không hai migration runners. | `prisma migrate deploy` DB trống rồi chạy lại không lỗi/không drop row; schema/roles đúng; `_prisma_migrations` ghi lại; P03 không sửa migration đã áp dụng. |
| P01-T04 | `deploy/keycloak/realm-template.json`, `deploy/apisix/routes.yaml`, `deploy/seaweedfs/bucket-policy.json`, Flowable DB/config và bootstrap script idempotent. | Restart từng service giữ realm/client, route, bucket, Flowable process data; default password bị thay, admin plane internal. |
| P01-T05 | `.env.example` + parser typed/fail-fast cho biến ở `deployment-spec-v1.md`; `deploy/scripts/bootstrap.ps1` và `.sh` không chứa secret. | Thiếu từng nhóm biến báo tên biến, không in giá trị; A/B/C dùng credential/namespace riêng; secret scan pass. |
| P01-T06 | `/api/v1/health/live|ready` cho ERP/core API, health worker, log JSON có `requestId`; smoke script ngoài gateway. | Tắt PG làm ERP/core ready fail, tắt Flowable làm workflow readiness/alert fail, không tạo vòng gateway↔app; public không lộ dependency detail. |
| P01-T07 | `evidence/G01.md` gồm clean-clone commands, compose config/ps, image digest, DB identity query và thời gian cài. | Người khác dựng một stack, sau đó stack thứ hai không xung đột; script khởi động không cần tệp bí mật có sẵn trên máy tác giả. |

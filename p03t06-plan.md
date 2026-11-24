# Kế hoạch P03-T06 — Backup và restore DB/volume

**Trạng thái:** đề xuất để Thịnh duyệt, chưa triển khai hoặc diễn tập. Chỉ bao gồm P03-T06; không đánh dấu hoàn thành các checkbox trong `documents/phase-plan/phase-03-data-files.md`.

## 1. Luồng chính

### Phạm vi và điểm nhất quán

- Một Compose project có một PostgreSQL volume `pg_data`, chứa ba DB riêng: `${APP_DB_NAME}` (mặc định `nexora`, gồm `platform`/`system`, attachment, audit và `_prisma_migrations`), `${KEYCLOAK_DB_NAME}` (`keycloak`: realm, users, clients, role), `${FLOWABLE_DB_NAME}` (`flowable`: deployment, process instance, task/history). Dump **cả ba** bằng `pg_dump -Fc` từ image PostgreSQL 17.6 đã pin; giữ schema, dữ liệu, ACL, role mapping. Không lấy riêng `pg_data` bằng `docker cp` lúc PG đang ghi.
- SeaweedFS: xuất toàn bộ object bytes và key thuộc ba bucket `private`, `quarantine`, `public` bằng S3 API, kèm SHA-256, size và danh sách key. Không chỉ lưu attachment `clean`: giữ cả pending/infected/error nếu bytes còn tồn tại. `platform.attachment` có `bucket` **logic**, `object_key`, `sha256_hex`, `size_bytes`, `scan_state`; bucket vật lý phải ánh xạ sang tên bucket của stack đích. Dữ liệu filer/volume ở `seaweed_data`; xuất S3 là định dạng restore chính, không sao chép thô volume này. `seaweed_config/s3.json` chứa access key/secret: tạo lại từ secret riêng của đích bằng `storage-bootstrap`, không đưa vào gói backup cấu hình. `redis_data` không cần backup vì Redis đang tắt persistence; `clamav_data` chỉ là signature có thể tải lại, phải kiểm signature trước khi mở scanner.
- Lưu **phiên bản cấu hình**, không chép file render hoặc credential: Git commit + digest image/Compose; SHA-256 của `deploy/apisix/config.yaml`, `deploy/apisix/routes.yaml`, `deploy/keycloak/realm-template.json`, `deploy/seaweedfs/bucket-policy.json`, BPMN trong `deploy/flowable/processes/`; danh sách process key/version/deployment ID từ Flowable nếu đã deploy; tên realm/client và tên biến/secret reference (`FLOWABLE_AUTH_REF`, `S3_SECRET_REF`, `PARTNER_OUTBOUND_SECRET_REF`, `env:OIDC_GATEWAY_CLIENT_SECRET`), không lấy giá trị. `deploy/apisix/apisix.generated.yaml` có client secret và có thể có TLS private key: **không** lưu; render lại với env đích. Không export realm thô: có thể chứa client secret. Không lưu `deploy/instances/*.env`, `deploy/certs/*-key.pem` hoặc `seaweed_config` trong manifest.
- Phân biệt manifest với payload: dump Keycloak/Flowable/app DB và object private có thể chứa mật khẩu hash, token/secret hoặc dữ liệu cá nhân. Chỉ **manifest/cấu hình** được giới hạn ở secret references; không thể gọi DB dump là “không có secret”. Gói payload phải ở ngoài Git, quyền `0700`/`0600`, mã hóa trước khi chép ra nơi lưu độc lập; khóa giải mã giữ tách gói, không ghi log. Chốt công cụ mã hóa và nơi giữ khóa trước khi code.
- Preflight: kiểm project nguồn đúng `-p`, ba DB/bucket/health, dung lượng đích và quyền lưu, backup trước đó, lock tránh hai job chạy đồng thời. Trong cửa sổ bảo trì, dừng/khóa mọi writer của **nguồn** (`gateway`, `erp`, `core-data`, `worker`, `file-scanner`, `file-reconciler`, bootstrap/seed và các job ghi); Keycloak/Flowable dừng để không ghi riêng hai DB. Giữ `postgres` và `seaweedfs` chạy cho dump/S3 export. Kiểm không còn writer/transaction đang ghi và S3 object đang upload; nếu không bảo đảm thì hủy backup, không nhận gói nhất quán. Dump tuần tự ba DB, export object, đọc row counts/checksum và lập manifest ở cùng cửa sổ đứng yên. Sau khi manifest và từng file SHA-256 hoàn thành, restart dịch vụ nguồn kể cả khi thất bại (trap), đo thời gian gián đoạn. Không dùng `docker compose down -v`.
- Manifest chứa instance/project nguồn, thời điểm UTC bắt đầu/kết thúc, phiên bản schema, tên DB/bucket, số row từng bảng (ít nhất `platform.attachment`, `platform.audit_log`, `system.membership`, `_prisma_migrations` và bảng Flowable/Keycloak có dữ liệu), số object/bytes/bucket, từng key và SHA-256, SHA-256 + size của ba dump và manifest version. Ghi manifest sau khi đã kiểm dump có TOC đọc được (`pg_restore -l`); file tạm không được coi là bản backup hoàn chỉnh. Đối chiếu attachment có bytes với key/checksum trong S3; riêng object đã purge (ví dụ infected có `quarantine_purged_at`) phải được ghi nhận rõ, không báo thiếu giả. Chặn nếu object mất hoặc hash khác; orphan cần ghi riêng và xử lý theo chính sách, không âm thầm bỏ qua.

### Restore trên project mới

1. Dùng **checkout riêng** ở đúng commit/image pin, env riêng và project name mới (ví dụ nguồn `nexora-a`, đích `restore-a-YYYYMMDD`). Giữ `INSTANCE_ID=a`/`ORG_CODE` của bản dữ liệu nếu muốn giữ user/membership/subject; đổi host port/URL để không xung đột. Preflight bắt buộc: tên project đích khác nguồn, volume `pg_data`/`seaweed_data` đích chưa tồn tại, đường dẫn đích không trỏ env/bucket nguồn; fail closed nếu tồn tại, không có `--clean`, `down -v` hoặc thao tác xóa tự động. Không chạy `bootstrap.sh` trên checkout nguồn vì `apisix.generated.yaml` là file dùng chung trong checkout.
2. Kiểm SHA-256 toàn bộ payload đã giải mã trong môi trường hạn chế, kiểm manifest version và `pg_restore -l`; tạo mạng/PG mới và roles/DB bằng `db-bootstrap` với **credential riêng của đích**. Chưa khởi động `db-migrate`, `keycloak`, `keycloak-bootstrap`, `flowable`, `storage-bootstrap`, `erp` hay worker trước khi restore DB để tránh ghi/seed/migrate vào DB rỗng. Restore ba dump vào ba DB trống với `pg_restore --exit-on-error --no-owner` (giữ ACL nếu roles đã được tạo); kiểm chính xác grant/role sau restore, nhất là app/core/audit. Nếu ACL trong dump gắn role nguồn riêng, chốt mapping trước restore; không bỏ `--no-acl` rồi tuyên bố phân quyền đã hồi phục.
3. Cấp **secret đích** ngoài backup (DB roles, S3 identities, gateway OIDC client, Flowable admin, Keycloak master admin/TOTP). Keycloak DB dump có client credentials và account/hash từ nguồn; master admin trong DB không tự đổi theo `KC_BOOTSTRAP_ADMIN_PASSWORD` mới. Xác định cách dùng credential quản trị được ủy quyền để đăng nhập/rotate rồi cập nhật env đích; tuyệt đối không để clone hoạt động với secret nguồn trên mạng tin cậy chung. Khi chưa giải quyết được bước này, giữ gateway và client route đóng. Tạo `seaweed_config` đích bằng `storage-bootstrap`, khởi chạy SeaweedFS với bucket đích, import object theo bucket **logic** và key cũ; kiểm hash/size từng object trước khi mở scanner/reconciler. Nếu đổi hostname/issuer, chỉnh redirect/JWKS và cấu hình realm **sau** restore, render APISIX từ env đích; không đổi `sub` hay `organizationId` bằng seed.
4. Sau khi DB + objects + secrets nhất quán, kiểm `_prisma_migrations` trùng bản code; chỉ chạy `db-migrate` nếu có migration mới được chủ đích cho phép, không tự migrate trong diễn tập cùng commit. Khởi động Keycloak/Flowable, rồi gateway, ERP/core/worker/scanner/reconciler; chỉ mở route ngoài sau khi kiểm chứng. BPMN phải có deployment version đã ghi trong manifest; nếu chưa deploy thì ghi `chưa có`, không tạo process giả để báo đạt.
5. So row counts theo bảng DB (không chỉ tổng), `_prisma_migrations`, attachment ID/key/state và SHA-256 bytes; kiểm object tồn tại ở đúng bucket. Kiểm đăng nhập/issuer, role `administrator`/`staff`/`viewer`, owner private, 401/403/404/423/200 theo API hiện có; kiểm quyền PG bằng thao tác bị từ chối (`core_data` không UPDATE/DELETE audit, `app_runtime` không UPDATE core_record/INSERT attachment). Nếu đã có process chạy: đối chiếu businessKey, process definition/version, task và trạng thái local trước/sau, kiểm resume trên **clone** không tạo task trùng. Hiện bridge nghiệp vụ P04/P07 chưa có: chỉ kiểm Flowable DB/deployment và ghi rõ `N/A` cho local approval/process thực, không nhận mục process state là đã kiểm nếu thiếu fixture. Người **không viết script** làm lại diễn tập từ runbook, lưu thời gian và kết quả vào evidence của T06 khi thực thi.

### Mục tiêu vận hành đề xuất, cần đo thực

- Với Compose demo nhóm, đề xuất **RPO ≤ 24 giờ**, **RTO ≤ 4 giờ cho một instance** tính từ lúc bắt đầu phục hồi đến khi các phép thử bắt buộc đạt. Đây là mục tiêu, không phải cam kết DR. Backup toàn bộ mỗi 24 giờ lúc ít giao dịch; giữ 7 bản ngày + 4 bản tuần ở thiết bị/nơi lưu khác Docker host, không xóa bản duy nhất còn tốt. Nếu thời gian dừng writer hoặc dung lượng không đủ, cần Thịnh chốt ngân sách/đổi lịch trước khi tự động hóa.
- Job theo lịch của host (cron/systemd timer hoặc Task Scheduler phù hợp máy nhóm) gọi script; mã thoát khác 0, thông báo khi không có **bản hoàn chỉnh mới trong 24 giờ**, khi checksum/TOC sai, khi thiếu object, khi thiếu dung lượng, hoặc không giải mã/đọc được payload. Mỗi tuần thử verify SHA-256 + TOC của bản mới nhất; mỗi tháng diễn tập restore stack khác bằng người thứ hai. Checksum chỉ phát hiện lỗi vận chuyển/tệp, **không thay thế restore drill**. Đo thời gian backup, downtime, thời điểm dữ liệu cuối và RTO/RPO thực; không tuyên bố disaster recovery nếu chưa diễn tập và ghi evidence.

## 2. Tệp dự kiến tạo/sửa khi được duyệt (không thực hiện trong lần này)

| Tệp | Vai trò |
| --- | --- |
| `deploy/scripts/backup.sh` | Entrypoint/lock/quiesce/PG dump, gọi export + kiểm manifest; trap luôn giải phóng nguồn. |
| `deploy/scripts/restore.sh` | Guard project/volume/credential đích, bootstrap DB rồi restore theo thứ tự, không xóa dữ liệu. |
| `deploy/scripts/backup-objects.mjs` | Dùng `@aws-sdk/client-s3` đã có để export/import + kiểm SHA-256 bucket, manifest; chỉ thêm nếu shell script không xử lý S3 an toàn. |
| `deploy/scripts/verify-backup.mjs` | Kiểm manifest/file/object + đối chiếu sau restore; có thể gộp vào `backup-objects.mjs` nếu ngắn hơn. |
| `deploy/backup-restore.md` | Runbook đầy đủ cho người khác: prereq, lịch/retention, recovery, failure/rollback và log đã redacted. |
| `tests/deploy/backup-restore.sh` | Một test tích hợp nguồn fixture và project đích riêng: hash, row, ACL, source untouched, từ chối restore vào nguồn/bản hỏng. |
| `deploy/README.md` | Link runbook và cách gọi script. |
| `documents/phase-plan/evidence/p03-t06.md` | Chỉ tạo khi có log drill thật, người chạy, RPO/RTO đo được; không cập nhật checkbox spec theo kế hoạch này. |

Mọi file nguồn mới cần header `SPDX-License-Identifier: AGPL-3.0-only`. Artifact backup/manifest thật lưu **ngoài repo**, không thêm dump, `.env`, khóa, realm export hoặc private object vào Git. Chỉ sửa `deploy/compose.yml` nếu thử nghiệm chứng minh cần service/volume mount bổ sung; ưu tiên dùng project Compose hiện có.

## 3. Các commit dự kiến (khi code, theo phong cách repo)

1. `feat(p03-t06): back up three databases and S3 objects with verified manifest` — exporter, quiesce, checksum, failure handling; test backup nhất quán.
2. `feat(p03-t06): restore verified backup to isolated Compose project` — restore guard, bootstrap order, ACL/object checks; test refusal/restore.
3. `docs(p03-t06): document restore drill and measured recovery targets` — runbook, lệnh vận hành, evidence chỉ sau drill thực. Không commit `p03t06-plan.md` theo quy tắc nhóm.

## 4. Kiểm chứng dự kiến (lệnh chạy sau khi triển khai, không phải kết quả đã chạy)

Chạy từ repo root; ví dụ nguồn `nexora-a` và đích `restore-a-20261119` trong **checkout khác**. Các script `backup.sh`, `restore.sh`, `verify-backup.mjs` và test dưới đây là **dự kiến**, chưa tồn tại:

```sh
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps config -q
bash deploy/scripts/smoke.sh a nexora-a
bash deploy/scripts/backup.sh a nexora-a /path/outside-repo/backup-a
node deploy/scripts/verify-backup.mjs /path/outside-repo/backup-a
pg_restore -l /path/outside-repo/backup-a/nexora.dump >/dev/null
pg_restore -l /path/outside-repo/backup-a/keycloak.dump >/dev/null
pg_restore -l /path/outside-repo/backup-a/flowable.dump >/dev/null
```

`/path/outside-repo/backup-a` ở ví dụ là vùng tạm có quyền hạn chế; nếu gói mã hóa thì verify/TOC chỉ chạy **sau giải mã trong vùng tạm**, không ghi bản rõ ra kho chung. Không dùng `docker compose config` thiếu `-q` vì lộ credential. Lệnh dump thực lấy tên DB từ env hợp lệ, không hardcode tên nếu đã cấu hình khác.

```sh
# Chạy trong checkout đích, với env cùng INSTANCE_ID=a nhưng port/secret riêng.
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p restore-a-20261119 config -q
bash deploy/scripts/restore.sh /path/outside-repo/backup-a a restore-a-20261119
bash deploy/scripts/smoke.sh a restore-a-20261119
bash tests/deploy/backup-restore.sh
npm run check:spdx
npm run check:secrets
```

- Sau backup: `docker compose ... -p nexora-a ps` và `bash deploy/scripts/smoke.sh a nexora-a` vẫn OK; row counts/attachment hash trên nguồn không đổi khi đứng yên. Gói lỗi/incomplete không được xoay retention như bản tốt. Thử cố ý sửa một byte dump/object và bỏ một key: verify/restore phải fail trước khi bật route.
- Trước restore: thử truyền `-p nexora-a` hoặc project có volume: script phải từ chối **trước bất kỳ ghi/xóa nào**. Sau restore: so bảng số hàng, attachment hash/bucket/scan state, quyền PG, 401/403/404/423/200 và Flowable process state nếu fixture tồn tại; đọc log redacted, không có password/token. Thử restore lần nữa vào cùng project phải từ chối; source smoke và row counts vẫn OK.
- Người thứ hai thực hiện toàn bộ runbook trên clone sạch, đo RPO/RTO/downtime, ghi bằng chứng trong `documents/phase-plan/evidence/p03-t06.md`. Nếu thiếu fixture Flowable hoạt động ở P03, ghi giới hạn và hẹn kiểm bổ sung tại P04/P07; không báo G03 đạt thay cho bài diễn tập đầy đủ.

## 5. Cần Thịnh chốt trước khi code

1. Đích backup độc lập và dung lượng thực tế cho 7 ngày + 4 tuần? Công cụ mã hóa nào có sẵn cho cả nhóm, ai giữ khóa và thực hiện rotate; có máy thứ hai để diễn tập không?
2. Chấp nhận cửa sổ dừng toàn bộ writer mỗi ngày không? Có nguồn ghi ngoài Compose/cron hoặc nhiều instance chung Docker host không? Nếu downtime vượt ngân sách, cần thiết kế snapshot/PITR khác trước khi hứa RPO/RTO.
3. Restore clone giữ nguyên `INSTANCE_ID`/`organizationId` và chặn mọi kết nối ra partner ngoài, hay cần chuyển tổ chức/issuer? Chọn URL/port riêng, cách cô lập mail/webhook/federation để clone không tác động hệ thống nguồn.
4. Nguồn giữ và cách rotate credential Keycloak master/client, Flowable admin, S3, DB khi restore? DB Keycloak phục hồi credential cũ; ai có quyền truy cập để thay chúng trước khi mở clone? Chốt mapping PG role nếu username nguồn khác env đích.
5. Có fixture process instance/task thực để kiểm state ở T06 không? Hiện có BPMN file và Flowable DB, nhưng bridge nghiệp vụ thuộc P04/P07. Nếu chưa có, thống nhất ghi `N/A` và kiểm bổ sung khi process chạy thật, không giả vờ hoàn tất checkbox thứ hai.
6. Có cho phép artifact **bản rõ tạm thời** trên máy chạy job không, đặt quota/quyền/xóa an toàn thế nào? Nơi lưu lâu dài phải mã hóa và ngoài Git; xác nhận chính sách dữ liệu/quarantine đã purge.

# Runbook P03-T06 — sao lưu và khôi phục

Chạy từ gốc checkout. Mỗi gói gồm ba `pg_dump -Fc` (app, Keycloak, Flowable), danh sách hàng, object thuộc ba bucket, SHA-256 và `manifest.json`. Manifest ghi commit, digest cấu hình, phiên bản process và tên secret reference; **payload DB/object vẫn có thể chứa secret và dữ liệu cá nhân**. Không đưa gói hoặc `.env` lên Git.

## Chuẩn bị

- Docker Engine, Docker Compose, Node.js 22+, Git; dung lượng đủ cho ba dump và toàn bộ object; thư mục ngoài checkout chỉ người vận hành đọc được. Có `age` và public key người nhận nếu chuyển máy; giữ private key tách gói.
- Nguồn `nexora-a` phải healthy (`bash deploy/scripts/smoke.sh a nexora-a`), ba DB và bucket sẵn sàng. Dừng mọi writer ngoài Compose (cron, import, upload hoặc phiên PG bên ngoài); script tự dừng gateway, app, Keycloak, Flowable, kiểm phiên DB đang hoạt động rồi khởi động lại container đã dừng ngay cả khi lỗi. Không chạy seed/bootstrap trong cửa sổ backup. Đảm bảo không còn upload S3 đang diễn ra.
- Đích là checkout **riêng** tại đúng commit ghi trong manifest, `deploy/instances/a.env` riêng đã kiểm bằng `bash deploy/scripts/bootstrap.sh a restore-a-20261119`; project/volumes/network chưa tồn tại, host port/URL không trùng nguồn. Role và tên DB phải khớp manifest; giữ `INSTANCE_ID`/`ORG_CODE` để giữ membership. Cấp credential đích ngoài gói và chuẩn bị cách xoay credential Keycloak đã nằm trong DB được restore. Với drill này dùng credential nguồn; clone chỉ chạy trong môi trường cô lập của đội, không mở cho đối tác/mạng dùng chung. Khóa mọi outbound mail/webhook/federation trước khi mở ứng dụng clone.
- Máy thiếu Compose plugin: dùng hàm `docker()` và `export -f docker` trong [deploy/README.md](./README.md#instances-a--b--c) trong cùng Bash session, kể cả khi gọi script bằng `bash`.

## Backup và kiểm gói

```bash
mkdir -p "$HOME/nexora-backups"
chmod 700 "$HOME/nexora-backups"
bash deploy/scripts/smoke.sh a nexora-a
bash deploy/scripts/backup.sh a nexora-a "$HOME/nexora-backups/a-20261119"
node deploy/scripts/verify-backup.mjs "$HOME/nexora-backups/a-20261119"
for db in app keycloak flowable; do docker run --rm -v "$HOME/nexora-backups/a-20261119:/backup:ro" postgres:17.6 pg_restore -l "/backup/$db.dump" >/dev/null; done
bash deploy/scripts/smoke.sh a nexora-a
```

Chỉ coi gói có `manifest.json` và verify thành công là hoàn chỉnh. Ghi thời gian chạy và khoảng gateway/writer dừng theo log vận hành. Nếu backup lỗi, kiểm nguồn đã chạy lại, sửa nguyên nhân, tạo **tên gói mới**; không dùng gói chưa hoàn chỉnh. Không xóa volume nguồn.

Script tạo thư mục gói `0700`, file `0600`; container xuất object và manifest chạy bằng UID/GID của người gọi script. Chính người đó có thể đọc/ghi toàn bộ gói để verify, mã hóa và chuyển máy; group/other không có quyền.

## Chuyển máy và retention

Mỗi cuối ngày làm việc và ngay trước buổi demo: chạy backup, verify và lưu bản mã hóa ở nơi độc lập Docker host. Khi chép sang máy khác, mã hóa **toàn bộ** thư mục (kể cả manifest) trước khi truyền; truyền chỉ file `.age`:

```bash
tar -C "$HOME/nexora-backups" -cf - a-20261119 | age -r '<AGE_PUBLIC_KEY>' -o "$HOME/nexora-backups/a-20261119.tar.age"
# Trên máy cô lập của người nhận, giữ private key riêng với gói:
age -d -i /path/to/private-key a-20261119.tar.age | tar -x -C /path/to/private/staging
node deploy/scripts/verify-backup.mjs /path/to/private/staging/a-20261119
```

Đặt quyền staging `0700`, file gói `0600`, không in khóa/secret vào log. Giữ thủ công **3 gói hoàn chỉnh gần nhất** sau khi kiểm gói mới và bản mã hóa độc lập; không xóa bản tốt cuối cùng. Dump rõ tạm thời phải được quản lý và xóa theo chính sách nội bộ sau khi xác nhận lưu trữ an toàn.

## Restore và đối chiếu

Trong checkout đích đã render gateway riêng, sau khi giải mã và verify:

```bash
node deploy/scripts/verify-backup.mjs /path/to/private/staging/a-20261119
bash deploy/scripts/restore.sh /path/to/private/staging/a-20261119 a restore-a-20261119
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p restore-a-20261119 --profile apps up -d --build
bash deploy/scripts/smoke.sh a restore-a-20261119
```

Restore kiểm commit/config, source project khác đích, project/volume đích mới; bootstrap DB, restore ba dump giữ ACL, kiểm row count, import object rồi kiểm SHA-256. Script để gateway/app đóng tới khi người vận hành bật. Sau bật: so `manifest.counts` nghiêm ngặt với các bảng còn lại; bỏ qua `public.*_session` **chỉ trong Keycloak** khi so row count sau khởi động và khi so hai lần backup nguồn. Bảng phiên là trạng thái runtime do Keycloak tự sinh/xóa khi khởi động, không thuộc dữ liệu nghiệp vụ phải khôi phục; dump và checksum vẫn kiểm toàn bộ bảng. Đối chiếu `manifest.attachments` (ID, key, bucket, scan state, SHA-256/size), object thực với hash, quyền PG bằng thao tác UPDATE/DELETE/INSERT bị từ chối; kiểm login/issuer, quyền truy cập API và `_prisma_migrations`. Với Flowable process chạy thật, so business key, definition/version, task và resume trên clone; hiện process state nghiệp vụ **N/A** (bridge P04/P07 chưa có). BPMN deployment nếu có phải trùng manifest.

Test tích hợp dùng checkout đích riêng với env, port, secret đã chuẩn bị, và thư mục ngoài repo:

```bash
bash tests/deploy/backup-restore.sh a nexora-a /absolute/path/to/target-checkout restore-test-a /absolute/path/to/backups
```

Nếu restore lỗi: giữ gateway/ứng dụng đích đóng, giữ gói gốc và log đã che secret, sửa lỗi trong đích mới khác thay vì restore đè hay `down -v` nguồn. Nguồn tiếp tục chạy; nếu nguồn chưa lên sau backup, kiểm `docker compose ... ps`, khởi động dịch vụ bị dừng theo README rồi chạy smoke. Nếu kiểm quyền, checksum hoặc migration không khớp, không công bố clone. Xoay credential Keycloak/client và cập nhật cấu hình đích trước khi dùng ngoài môi trường drill cô lập. RPO thực là tuổi bản backup cuối được verify tại thời điểm sự cố; RTO đo từ bắt đầu restore đến khi các kiểm tra bắt buộc đạt. Chưa coi đây là disaster recovery liên máy cho đến khi người thứ hai hoàn tất drill.

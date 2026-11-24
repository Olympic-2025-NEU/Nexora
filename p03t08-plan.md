# P03-T08 — Kế hoạch explain-first cho Gate G03

**Trạng thái:** chỉ là kế hoạch, chưa chạy gate, chưa tạo `documents/phase-plan/evidence/G03.md`, chưa đánh dấu P03-T08 hoàn thành. Căn cứ: `phase-03-data-files.md` mục/hàng P03-T08, `test-matrix.md` §4–5, evidence T06/T07.

## 1. G03 chốt điều gì?

G03 xác nhận trên **checkout mới từ origin và môi trường cô lập** rằng migration có thể triển khai lại, một lệnh ghi không để aggregate/audit/outbox lệch nhau khi lỗi hoặc tranh chấp, tệp chưa qua kiểm dịch không phát tán, và backup có thể khôi phục kèm quyền DB. Đây là quyết định nghiệm thu có log, commit, cấu hình đã che, số đo và người review; không phải chạy lại test trên máy tác giả rồi tự nhận PASS. Theo hàng P03-T08, **chỉ một failure case** làm lệch aggregate/audit/outbox, hoặc tệp `pending` tải được, là **FAIL gate**. Lỗi quyền, checksum hay restore cũng không thể ký PASS khi chưa xử lý.

T06 đã PASS 6/6 backup/restore trên cùng máy, restore 116 giây và smoke 8/8; chưa diễn tập liên máy. T07 đã PASS records 6/6, evidence 4/4 và headless 14/14 **sau khi gắn mapper tạm trên realm dev**. G03 kiểm tra lại trên nguồn/instance sạch, không chép kết quả cũ thành log gate. Test transaction hiện dùng bảng `tx_spike_*` và fixture tồn giả lập; **không** tuyên bố đã chứng minh confirm/stock M03 thật (P06/P07/P04 sở hữu phần đó). Projection ERP sau commit và owner document/lot vẫn mở ở T07; ghi rõ giới hạn trong quyết định G03.

## 2. Chuẩn bị clone sạch và phân công

Các lệnh **dự kiến**, chạy về sau bởi Milo qua SSH trên máy có mạng/Docker, từ repo nguồn để lấy URL origin; không chạy trong phiên viết kế hoạch này. Chốt instance, port và cửa sổ trước khi chạy. Dùng đường dẫn tuyệt đối khác nhau, thư mục backup ngoài cả hai checkout; không tái sử dụng project/volume nguồn. Trên máy SSH, làm theo `deploy/README.md` và `deploy/backup-restore.md`:

```bash
ORIGIN="$(git remote get-url origin)"
REV="$(git rev-parse origin/phase03/p03-t08-gate-g03)"
git clone --branch phase03/p03-t08-gate-g03 "$ORIGIN" "$HOME/nexora-g03-source"
git clone --branch phase03/p03-t08-gate-g03 "$ORIGIN" "$HOME/nexora-g03-restore"
git -C "$HOME/nexora-g03-source" switch --detach "$REV"
git -C "$HOME/nexora-g03-restore" switch --detach "$REV"
git -C "$HOME/nexora-g03-source" rev-parse HEAD
git -C "$HOME/nexora-g03-restore" rev-parse HEAD
```

Nếu commit gate chưa ở origin, **không dùng checkout cũ và gọi đó là clone sạch**: thống nhất commit nguồn đã push cho phép thử, pin cùng `REV` ở hai clone; bằng chứng tài liệu mới sẽ là commit riêng sau thử. Milo chạy `npm ci` ở **cả hai** checkout (và `npm run db:generate` nếu Prisma Client chưa có), chuẩn bị `deploy/instances/a.env` riêng từ bootstrap, không chuyển/commit env hoặc credential. Trong từng checkout dùng các lệnh sau với project khác nhau; `bootstrap.sh` tạo env nếu thiếu, người vận hành chỉnh host port/URL không trùng nguồn rồi chạy lại bootstrap để validate. Không log `docker compose config` dạng mở rộng.

```bash
# Trong $HOME/nexora-g03-source
npm ci
bash deploy/scripts/bootstrap.sh a g03-source
# Chỉnh file env bị Git ignore: port, PUBLIC_BASE_URL, OIDC_REDIRECT_URI_* cho nguồn riêng.
bash deploy/scripts/bootstrap.sh a g03-source
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p g03-source --profile apps up -d --build
bash deploy/scripts/smoke.sh a g03-source

# Trong $HOME/nexora-g03-restore
npm ci
bash deploy/scripts/bootstrap.sh a g03-restore
# Chỉnh env/port/URL cho đích riêng, không đè nguồn; bootstrap lại để render gateway.
bash deploy/scripts/bootstrap.sh a g03-restore

# Tạo thư mục backup private ngoài cả hai checkout; chạy từ checkout nguồn.
mkdir -p "$HOME/nexora-g03-backups"
chmod 700 "$HOME/nexora-g03-backups"
bash tests/deploy/backup-restore.sh a g03-source "$HOME/nexora-g03-restore" g03-restore "$HOME/nexora-g03-backups"
```

`backup-restore.sh` yêu cầu hai checkout **cùng HEAD**, env đích, gateway đã render và thư mục backup đã có; nó tự chạy source backup/verify, restore vào project đích mới, smoke và dọn **đích**. Test schema/transaction/audit/files/scan/records/evidence bên dưới cũng tạo DB/container riêng bằng Docker. Nếu máy SSH thiếu Compose plugin, Milo áp dụng fallback `docker()` trong `deploy/README.md` (mount **cả hai** checkout và thư mục backup). Không dùng fallback này như lời hứa Docker sẵn có. Người viết tài liệu chỉ tổng hợp log đã che vào evidence, xin review và tạo commit theo điều kiện mục 7; mọi việc cần Docker/mạng do Milo chạy.

## 3. Ánh xạ yêu cầu → kiểm tra → bằng chứng

Chạy từ **clone nguồn**, lưu lệnh, exit code, thời điểm, `REV` và stdout/stderr đã lọc secret cho từng ca. `package.json` ánh xạ `test:platform:*` qua `scripts/run-platform-test.mjs` tới `tests/platform/run-*.sh`; `test:contracts` kiểm OpenAPI/JSON/Python JCS. Không coi `npm test` thay thế integration Docker.

| Yêu cầu | Lệnh/test hiện có | Kỳ vọng và bằng chứng |
| --- | --- | --- |
| Migration DB trống, upgrade, chạy lại, restore snapshot | `npm run test:platform:schema` → `run-schema.sh`, `schema.integration.mjs` | Exit 0; DB Phase 02 nâng cấp giữ fixture, `migrate deploy` chạy hai lần không lỗi; DB trống có bảng/constraint/migration, snapshot cũ restore được. Log migration + schema dump ở mục 4. |
| Quyền DB theo role | Cùng `test:platform:schema` → `schema.integration.mjs` ca `runtime roles are separate, least privilege and fail closed`; thêm `tests/deploy/backup-restore.sh` phần `PASS PG denied` | `core_data` không `UPDATE/DELETE platform.audit_log`, `app_runtime` không `UPDATE platform.core_record` (và không `INSERT platform.attachment`); test dùng `has_table_privilege`, Prisma write bị từ chối; drill xác nhận lại sau restore bằng `SET ROLE`. Log quyền sau restore. |
| Rollback, tranh chấp, lock ordering | `npm run test:platform:transaction` → `run-unit-of-work.sh`, `transaction.integration.test.ts` | Inject lỗi sau aggregate/stock/movement/audit/outbox: draft, tồn cũ, **0** movement/audit/outbox; thành công ghi đúng một lần; hai writer tranh 8 đơn vị chỉ một confirm 6, còn 2; thứ tự khóa ngược không deadlock; log, số đo thời gian/deadlock. |
| Audit nguyên tử, append-only, redaction | `npm run test:platform:audit` → `run-audit.sh`, `audit.integration.test.ts` | Record + audit cùng commit/rollback; token/secret sentinel không vào JSONB; query theo request/target; UPDATE/DELETE runtime bị chặn. Log đã che. |
| Upload/checksum/privacy, object lỗi | `npm run test:platform:files` → `run-files.sh`, `files.integration.test.mjs` | Pending HTTP download **423**, URL quarantine/private trực tiếp **403**, người khác **404**, clean mới tải **200**; hash SHA-256 khớp; lỗi PG/S3 được dọn, restart giữ bytes. Log trạng thái/HTTP và checksum fixture, không lưu bytes private trong Git. |
| Quét sạch/nhiễm/lỗi | `npm run test:platform:scan` → `run-scan.sh`, `scan.integration.test.mjs` | ClamAV thật: clean chuyển private, infected (EICAR test pattern sinh runtime), pending/infected/error/timeout đều không tải được (**423** ở service); retry có giới hạn, audit và hash sai fail closed. Log trạng thái + signature version đã che. |
| Evidence không lộ qua record | `npm run test:platform:evidence` → `run-evidence.sh`, `core-evidence.integration.test.mjs` | Ca PostgreSQL và policy: pending/infected/error bị **422** khi link/GET, người khác **404**, không có payload/audit mồ côi; ghi rõ ca mock và ca PostgreSQL, không gọi mock là E2E gateway. |
| Structured records | `npm run test:platform:records` → `run-records.sh`, `core-records.integration.test.mjs`; `npm run test:contracts` | PostgreSQL: idempotency, audit và rollback cùng giao dịch; schema/kind/owner lạ bị từ chối, role không đủ **403**, contract hợp lệ. Log test/contract, không gộp với T07 như kết quả gate mới. |
| Backup/restore, RPO/RTO | `bash tests/deploy/backup-restore.sh a g03-source "$HOME/nexora-g03-restore" g03-restore "$HOME/nexora-g03-backups"`; `verify-backup.mjs` do script gọi | 6 ca PASS: gói hợp lệ, dump/object hỏng bị từ chối, không restore đè nguồn, row counts/attachment hashes/ACL/smoke đích khớp, nguồn không đổi. Ghi thời điểm backup đã verify, thời điểm sự cố giả định, tuổi backup = **RPO đo**; bấm giờ từ bắt đầu restore tới smoke + đối chiếu đạt = **RTO đo**. Đối chiếu mục tiêu T06: RPO tối đa một ngày làm việc khi có backup cuối ngày đã verify, RTO khoảng 5 phút với dữ liệu hiện tại; 116 giây T06 chỉ là mốc tham chiếu, không phải số đo G03. Flowable process state ghi N/A nếu chưa có process definition, không đánh PASS giả. |
| Headless/gateway | `bash deploy/scripts/smoke.sh a g03-source`; `node deploy/scripts/smoke-core.mjs a` **chỉ khi** project tên mặc định `nexora-a`, dev user sẵn và đã dừng ERP/worker/DX-Lab theo hướng dẫn script | Smoke nền kiểm 8 probe. Không dùng `smoke-core.mjs` với `g03-source`: script hardcode `nexora-a`, nên nếu cần smoke headless đầy đủ phải chọn instance/project mặc định cô lập hoặc chờ script được sửa ở task sở hữu. Lưu trace HTTP thật qua gateway theo mục 4, không suy diễn PASS 14/14 từ T07. |

## 4. Khung `documents/phase-plan/evidence/G03.md` khi thực thi

- Metadata: thời gian, commit `REV`/origin, host/Compose project đã ẩn định danh nhạy cảm, image digest, instance/env **đã che**, fixture, người chạy, reviewer; PASS/FAIL/BLOCKED theo từng dòng bảng trên. Gắn file log đã che, exit code, `sha256sum` của log/bản schema đã che và checksum SHA-256 của fixture upload/bytes tải về, đối chiếu manifest object. Log gốc và backup private để ngoài Git; không đưa `.env`, token, object private, dump dữ liệu hoặc khóa vào evidence.
- Schema dump **chỉ cấu trúc** từ DB clone (sau migration), ví dụ Milo chạy trong clone nguồn: `docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p g03-source exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$APP_DB_NAME" --schema-only --no-owner --no-privileges --schema=platform --schema=system' > /path/to/private/schema.sql`. Kiểm dump không chứa dữ liệu/credential; loại chú thích/giá trị fixture hoặc định danh nhạy cảm nếu có, thay bằng `[REDACTED]` trong **bản sao** đính kèm evidence; ghi quy tắc và hash bản đã che. `--no-privileges` làm mất ACL khỏi dump: dùng log `schema.integration.mjs` và `PASS PG denied` riêng để chứng minh quyền. Không đưa dump dữ liệu `pg_dump -Fc` vào Git.
- Restore drill: lệnh, hash manifest/gói lưu riêng, sáu kết quả, row counts và object checksum đã tổng hợp, 4 quyền bị chặn, smoke nguồn/đích, thời điểm đầu/cuối và **RPO/RTO tính từ mốc ghi rõ**; nói rõ cùng máy hay khác máy và Flowable process state N/A nếu phù hợp.
- Gateway request trace: Milo tạo request ID thử nghiệm và gọi **gateway loopback trên clone**, ví dụ `curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Request-Id: g03-no-token-001' -d '{}' 'http://127.0.0.1:<GATEWAY_HTTP_PORT>/api/v1/core/records'` (không token: kỳ vọng 401); kiểm thêm `GET /api/v1/files/<fixture-id>?download=1` theo fixture nếu có. Ghi URL path/method, request ID, status, thời gian, correlationId nếu log gateway có; xóa `Authorization`, cookie, body, IP/ID cá nhân trước lưu. Token dev hiện `aud="account"` nhưng core-data đòi `erp-browser`; T07 đã gỡ mapper tạm. **Đề xuất:** dùng integration tests DB/HTTP làm bằng chứng chức năng chính và trace live gateway **401** (thiếu token hoặc token sai audience) làm bằng chứng default deny; ghi rõ **chưa chứng minh live 200 với token thật**. Nếu reviewer yêu cầu trace thành công 200/201 qua gateway để đóng G03, đánh BLOCKED và đợi đội identity sửa realm template/bootstrap theo task sở hữu, rồi chạy lại trên clone sạch. Không tự thêm mapper tạm/lén, không đổi `OIDC_AUDIENCE` để ép PASS. Phương án thay thế: chỉ sau khi realm chính thức được sửa mới thu trace 200/401/403 đủ bộ.
- Kết luận gate và chữ ký: bảng PASS/FAIL/BLOCKED, các giới hạn T07 và AC tương lai, reviewer độc lập/owner waiver nếu được chốt, tên/ngày/commit/chữ ký hoặc liên kết review; không ký thay. Dẫn tới `phase-03-data-files.md` checkbox P03-T08 khi thực sự đạt.

## 5. Cần chủ repo chốt trước giờ chạy

1. **Ai review/ký G03?** Khương/Minh (không là tác giả evidence), hay owner waiver theo G01/G02? Nếu waiver, ghi người chấp thuận và phạm vi rõ; không tự coi waiver là PASS cho failure thật.
2. **Drill liên máy lần này?** T06 khuyến nghị gói backup mã hóa đặt ở máy đồng đội và drill khôi phục có video dự phòng demo. Khuyến nghị đưa vào G03 nếu có máy/cửa sổ; nếu để riêng, ghi PENDING và không tuyên bố DR liên máy. Kiểm file gói mã hóa/khóa nhận theo runbook, không đẩy backup vào repo.
3. **Instance/cửa sổ?** Chọn `a` với project riêng và port riêng hoặc một instance test cô lập; script chỉ chấp nhận `a|b|c`, `smoke-core.mjs` hiện chỉ dùng project mặc định. Dự trù **45–90 phút** cho hai clone + `npm ci` + build/bootstrap, 7 runner có ClamAV, drill (~4 phút ở T06) và rà evidence; lần đầu tải image hoặc lỗi realm/port có thể lâu hơn. Chốt khung thời gian và chủ máy SSH trước khi bắt đầu.

## 6. Nếu gate fail

FAIL ngay khi một injected failure để aggregate confirmed nhưng audit/outbox thiếu, rollback sót movement/tồn, hai writer cùng confirm vượt tồn, hoặc file pending/infected/error tải được. FAIL/BLOCKED khi migration/upgrade không giữ dữ liệu, role có quyền ghi trái phép, checksum lệch, restore đè nguồn/không tái lập, log/trace thiếu bằng chứng bắt buộc. Phân biệt lỗi hạ tầng chưa chạy (BLOCKED, rerun sau khắc phục) với assertion vi phạm (FAIL). Ghi lệnh, commit, fixture, kết quả và người phát hiện; mở việc sửa tại task sở hữu (T01 schema/quyền, T02 transaction, T03 audit, T04–T05 file/scan, T06 restore, T07 records; audience mapper thuộc identity Phase 2). Sau fix, pin commit mới, tạo lại clone sạch và chạy lại phần gate bị ảnh hưởng cùng smoke/restore liên quan; hoãn ký/tick, không sửa spec để hợp thức hóa lỗi.

## 7. Commit dự kiến và điều kiện tick

Thông thường **một commit tài liệu sau PASS**: `documents/phase-plan/evidence/G03.md` với log đã che, trace, hash, số đo, reviewer; cộng tick `[x]` P03-T08 trong `documents/phase-plan/phase-03-data-files.md`. Chỉ tick khi clone nguồn/đích pin cùng commit, toàn bộ ca bắt buộc PASS, bằng chứng hiện trường đủ, reviewer/waiver hợp lệ ký, và scope trace/gói liên máy đã chốt được ghi trung thực. Nếu còn FAIL/BLOCKED: giữ `[ ]`, ghi evidence trạng thái mở (nếu đội cần), không tạo commit PASS. `p03t06-plan.md`, `p03t07-plan.md`, `p03t08-plan.md` ở gốc là kế hoạch nội bộ: giữ nguyên, **không stage/commit**.

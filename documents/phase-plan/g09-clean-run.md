# G09 — chạy lại từ clone sạch, không sửa DB bằng tay

## Phạm vi và an toàn

Gate dùng ba Compose project **mới** `nexora-g09-a/b/c`, ba PostgreSQL cluster/Keycloak/volume riêng và network `nexora-g09-federation`. Issuer nghiệp vụ vẫn là `nexora-a/b/c` vì đây là ba tổ chức của cùng kịch bản, còn nhãn Compose và state Docker hoàn toàn khác demo đang dùng. `prepare-g09-clean.mjs` tạo env ignored với cổng host +2000: ERP A/B/C `21080/21081/21082`, Keycloak `20080/20081/20082`. Script từ chối env có sẵn; không chạy `abc-reset` với prefix mặc định. Không đưa mật khẩu, OTP, token, env hoặc private cert vào Git/log.

Nếu máy không đủ RAM cho hai bộ A/B/C cùng lúc, dừng **container** của các project cũ (không `down -v`), rồi khởi động lại sau gate. Lệnh dừng là reversible; volume và database cũ giữ nguyên. Chỉ xóa project `nexora-g09-*` khi đã lưu bằng chứng và chắc chắn không còn cần inspect.

## Chuẩn bị clone

Từ một thư mục trống ngoài checkout đang làm:

```powershell
git clone --branch phase-09 https://github.com/Olympic-2025-NEU/Nexora.git Nexora-G09-clean
Set-Location Nexora-G09-clean
git status --short --branch            # phải sạch, branch phase-09
npm ci
npm run db:generate
$env:DEMO_ONLY = "true"
$env:NEXORA_DEMO_PROJECT_PREFIX = "nexora-g09"
node deploy/scripts/prepare-g09-clean.mjs
node deploy/scripts/prepare-abc-federation.mjs
./deploy/scripts/gen-local-certs.ps1
foreach ($i in @("a", "b", "c")) { node deploy/scripts/render-apisix-routes.mjs "deploy/instances/$i.env" }
docker network create nexora-g09-federation
```

`mkcert` phải có sẵn trước khi tạo cert. Nếu network đã tồn tại từ một lần chạy trước, kiểm không có container lạ rồi dùng lại; không xóa network đang phục vụ stack khác. `prepare-g09-clean.mjs` chỉ tạo mới, không tái tạo/đè credentials trên lần chạy lại. Bản clone sau `npm ci`, env/cert/render đều ignored; `git status --short` vẫn sạch.

## Dựng ba stack và seed

Chạy cùng ba Compose file cho cả ba instance, không bỏ overlay federation. Build từ **clone này**, dùng image tag `g09-clean` để không thay image của demo cũ:

```powershell
foreach ($i in @("a", "b", "c")) {
  docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file "deploy/instances/$i.env" -p "nexora-g09-$i" --profile apps config -q
  docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file "deploy/instances/$i.env" -p "nexora-g09-$i" --profile apps up -d --build
}
foreach ($i in @("a", "b", "c")) {
  node deploy/scripts/seed-abc.mjs $i
  bash deploy/scripts/deploy-flowable.sh $i "nexora-g09-$i"
}
node deploy/scripts/configure-abc-federation.mjs
node --test tests/e2e/abc-topology.test.mjs tests/e2e/abc-federation-topology.test.mjs
```

Chờ migrator/Keycloak/Flowable/ERP/gateway/worker healthy trước mỗi seed. `seed-abc.mjs` tạo fixture zero-stock, membership và partner, không tự tạo movement. `configure-abc-federation.mjs` kiểm project label/database identity rồi tạo bốn kết nối M2M theo `env:` secret reference. `abc-topology-drill.mjs` làm phát sinh stock nên **không** chạy trên canonical G09 này.

## Hành trình nghiệp vụ và chia sẻ trace

1. Trên Keycloak A/B/C mới, Administrator và Approver hoàn tất đổi mật khẩu tạm và TOTP theo yêu cầu; không gửi mật khẩu/OTP cho agent. Trình duyệt dùng `http://127.0.0.1:20080|20081|20082/realms/nexora/account`. Đăng nhập ERP `21080|21081|21082` bằng tài khoản tương ứng.
2. Chạy `node deploy/scripts/journey-p09-core.mjs` với `DEMO_ONLY=true` từ clone. Script dựng GoodsReceipt A 20 bằng API, dừng ở từng issue chờ Approver A/B/C quyết định qua `/trading/approvals`; người duyệt khác người tạo. Script tự xác nhận issue, transfer, receiving actual 10/6, sale 2 và assert balance sau từng bước. Giữ terminal chạy cho đến JSON `result: PASS`, ghi các ID và thông tin approval vào bằng chứng **không có token**. Nếu interrupted, dùng biến `DEMO_RESUME_*` đã ghi theo checkpoint của script; không tạo lại chứng từ bằng DB.
3. Administrator duyệt timeline sharing policy cho lô của A/B/C tại `/trace`, sau đó phát summary A→B, B→C và impact C→B, B→A theo `runbook-p09-federation.md` và [T07 evidence](evidence/p09-t07.md). Chỉ cho phép `public` ở các event cần relay; theo message ID và outbox/inbox trên `/admin/federation`. `node deploy/scripts/journey-p09-trace.mjs verify` chỉ PASS khi C thấy A/B/C, A nhận downstream C qua B và balance 8/4/4. Không cấp quyền rộng cho toàn issuer.
4. Chạy `node deploy/scripts/fault-p09-b-offline.mjs` (B tắt/khôi phục, A/C vẫn lên), rồi `journey-p09-trace.mjs verify`. Với A offline, dừng A `gateway erp` bằng đúng ba overlay, chạy `journey-p09-trace.mjs verify-offline`, khởi động lại A và `verify` lần nữa. Luôn khởi động lại trong `finally`/bước recovery; không dùng `down -v`.
5. Chạy `npm run test:platform:federation`, `npm run test:federation:outbound`, `npm run test:platform:ops`, `npm run test:gateway`, `npm run test:contracts` trên clone để khóa retry/dedupe, size/version/clock, role/privacy. Lưu topology/DB identity, document/outbox/inbox/ACK/source IDs, balance và gap bằng script evidence G09. Một test mô phỏng lỗi không thay thế kết quả API/UI live; đánh dấu rõ hai loại chứng cứ.

## Điều kiện đóng gate

AC-01/05/06/07/09 chỉ Done khi ba DB/identity/volume tách biệt, business journey từ zero-stock chạy PASS, approval có MFA, technical ACK và business receipt phân biệt, duplicate không cộng tồn, C vẫn có cache A/B khi A offline, A chỉ liệt kê downstream có chứng cứ và hiện gap, không lộ private payload. Nếu một bước manual chưa hoàn tất hoặc chỉ có kết quả từ demo cũ, giữ checklist G09 mở; ghi blocker và ID cụ thể trong `evidence/G09.md`.

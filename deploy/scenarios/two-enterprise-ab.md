# Kịch bản kiểm thử 2 doanh nghiệp (Instance A ↔ B)

**Mục đích:** Tham chiếu khi test hai DN cùng dùng Nexora — đơn hàng nội bộ, phiếu xuất/nhập, liên kết đối tác và chuyển hàng liên DN.  
**Topology chuẩn:** Compose project `nexora-a` + `nexora-b` (ports riêng, DB/Keycloak riêng).  
**Không dùng:** Instance C trong kịch bản này (C chỉ cần cho G09 A→B→C).

**Hàng hoá chi tiết (G0–G8, số tồn, checklist):** [`ab-goods-flows.md`](./ab-goods-flows.md) · script `deploy/scripts/journey-ab-goods.mjs`.

## 0. Bản đồ instance & cổng

| Vai trò | Project | Env | HTTP gateway | HTTPS | Keycloak | Postgres | Org |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DN A (xuất / bán) | `nexora-a` | `deploy/instances/a.env` | `19080` | `19443` | `18080` | `15432` | `ORG-A` / `nexora-a` |
| DN B (nhận / mua) | `nexora-b` | `deploy/instances/b.env` | `19081` | `19444` | `18081` | `15433` | `ORG-B` / `nexora-b` |

> Nếu máy đang chạy A với `-p nexora` (không phải `nexora-a`), vẫn giữ nguyên A; chỉ cần B dùng `-p nexora-b` và port `19081`. Script demo `seed-abc` / `configure-abc-federation` **bắt buộc** project `nexora-a|b|c` + `DEMO_ONLY=true`.

```mermaid
sequenceDiagram
  participant A as Instance A (ORG-A)
  participant Link as Partner link
  participant B as Instance B (ORG-B)
  Note over A,B: Mỗi bên catalog / kho / đơn hàng riêng
  A->>Link: Kết nối đối tác (system ID + ủy quyền 2 chiều)
  B->>Link: Kết nối đối tác chiều ngược
  A->>A: Nhập nội bộ → tồn → GoodsIssue (partner_transfer)
  A->>B: Thông báo chuyển hàng (federation)
  B->>B: Receiving (đối tác gửi = A) → cộng tồn
  Note over A,B: Trên chiều đó A = nhà cung cấp, B = bên nhận
```

## 1. Chuẩn bị môi trường

Từ root repo (`nexora/`):

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/prepare.mjs a   # bỏ qua nếu a.env đã có
node deploy/scripts/prepare.mjs b
node deploy/scripts/render-apisix-routes.mjs deploy/instances/a.env
node deploy/scripts/render-apisix-routes.mjs deploy/instances/b.env

# A (nếu chưa chạy, hoặc rename project sang nexora-a)
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml `
  --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build

# B — cổng 19081 / 15433 / 18081
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml `
  --env-file deploy/instances/b.env -p nexora-b --profile apps up -d --build
```

Kiểm tra:

```powershell
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a ps
docker compose -f deploy/compose.yml --env-file deploy/instances/b.env -p nexora-b ps
# Smoke (từng instance)
bash deploy/scripts/smoke.sh a nexora-a
bash deploy/scripts/smoke.sh b nexora-b
```

Đăng nhập ERP:

- A: `http://127.0.0.1:19080` (hoặc HTTPS theo `PUBLIC_BASE_URL` trong `a.env`)
- B: `http://127.0.0.1:19081`

Tài khoản demo (trong từng `*.env`, không commit):

| User env | Ghi chú |
| --- | --- |
| `KC_DEV_USERNAME` / `KC_DEV_USER_PASSWORD` | Staff — password grant ngay sau bootstrap |
| `KC_ADMIN_USERNAME` / `KC_ADMIN_PASSWORD` | Admin — mặc định Keycloak bắt **CONFIGURE_TOTP** → UI báo `invalid_grant` / “Account is not fully set up” cho đến khi enroll MFA **hoặc** chạy fix local bên dưới |
| `KC_APPROVER_USERNAME` / `KC_APPROVER_PASSWORD` | Approver — cùng yêu cầu MFA như admin |

Fix local (bỏ MFA bắt buộc + password không tạm) rồi seed membership:

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/fix-local-demo-users.mjs deploy/instances/b.env
# Seed org/membership (host → Keycloak/Postgres đã publish):
# set OIDC_BASE_URL=http://127.0.0.1:18081 và DATABASE_URL=@127.0.0.1:15433 rồi:
# node deploy/scripts/seed-system.mjs
```

### Liên kết federation đầy đủ (khuyến nghị khi test chuyển hàng)

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/prepare-abc-federation.mjs   # ghi M2M A↔B (và stub C nếu có env)
.\deploy\scripts\gen-local-certs.ps1
docker network inspect nexora-federation *> $null
if ($LASTEXITCODE -ne 0) { docker network create nexora-federation }

foreach ($i in @("a", "b")) {
  node deploy/scripts/render-apisix-routes.mjs "deploy/instances/$i.env"
  docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml `
    --env-file "deploy/instances/$i.env" -p "nexora-$i" --profile apps up -d erp gateway worker seaweedfs
}
foreach ($i in @("a", "b")) { node deploy/scripts/seed-abc.mjs $i }
node deploy/scripts/configure-abc-federation.mjs
# Flowable BPMN trước khi submit GoodsIssue
bash deploy/scripts/deploy-flowable.sh a nexora-a
bash deploy/scripts/deploy-flowable.sh b nexora-b
```

Chi tiết topology: [`../abc-topology.md`](../abc-topology.md). Model Partner / supplier–customer: [`../../documents/requirements/BRD-partner-link.md`](../../documents/requirements/BRD-partner-link.md).

## 2. Ma trận kịch bản

| # | Luồng | A làm gì | B làm gì | Kết quả kỳ vọng |
| --- | --- | --- | --- | --- |
| **S1** | Catalog độc lập | Tạo SP / biến thể / giá | Tạo SP riêng (SKU khác) | Không chia sẻ DB catalog |
| **S2** | Nhập nội bộ | Inbound local / goods receipt → confirm | Tương tự (hoặc seed có tồn) | Tồn A tăng; B độc lập |
| **S3** | Đơn hàng nội bộ | `/orders` hoặc `/pos` bán lô local | Bán lô local của B | Sale trừ tồn **local**; không federation |
| **S4** | Kết nối đối tác | `/partners`: thêm B, lưu liên kết, Kiểm tra liên kết | Thêm A, lưu liên kết 2 chiều | Status liên kết *Đã kết nối* hai bên |
| **S5** | Xuất liên DN A→B | GoodsIssue `partner_transfer` → duyệt → confirm → Partner transfer | — | Outbox A gửi; B có thông báo nhận |
| **S6** | Nhận hàng B | — | Inbound Nexora / receiving theo thông báo A, actual ≤ sent | Tồn B +actual; A thấy business receipt |
| **S7** | Chiều ngược B→A | (đối xứng S5–S6) | Issue + transfer tới A | A nhận; vai trò supplier/customer đảo |
| **S8** | Theo dõi lỗi | `/partners` khu vực theo dõi | Cùng | Retry / reprocess khi dead letter / mapping gap |
| **S9** | Cô lập sự cố | Tiếp tục S3 khi B `down` | `docker compose … -p nexora-b stop` | A vẫn bán nội bộ; transfer A→B retry/dead-letter |

## 3. Chi tiết thao tác UI (tham khảo)

### S1–S3 — Mỗi DN tự vận hành

1. **Sản phẩm:** `/products` — tạo SKU; gắn lô `/catalog/batches` (hoặc luồng batch hiện có).
2. **Kho:** `/inventory/warehouses`, xem tồn `/inventory/balances`.
3. **Nhập local:** `/trading/inbound` (nguồn local) → confirm.
4. **Đơn hàng / POS:** `/orders`, `/pos` — chọn lô có tồn; thanh toán/confirm theo flow hiện tại.
5. **Phiếu xuất nội bộ / sale:** issue purpose `sale` (nếu dùng chứng từ xuất gắn bán) — **không** nhầm với `partner_transfer`.

Checklist: số tồn sau bán khớp; chứng từ A không xuất hiện trên B.

### S4 — Kết nối đối tác (hub `/partners`)

1. Trao đổi **mã định danh hệ thống** (`nexora-a` / `nexora-b`) và thông tin ủy quyền qua kênh nội bộ.
2. A: Thêm đối tác B → **Thiết lập liên kết** (địa chỉ hệ thống B / cổng gateway) → ủy quyền 2 chiều → **Lưu** → **Kiểm tra liên kết**.
3. B: làm đối xứng với A.
4. Không gắn cố định “NCC/KH” trên Partner — vai trò theo chiều chứng từ.

### S5–S6 — Chuyển hàng A → B

1. A có tồn đủ; batch `available`.
2. A: tạo **GoodsIssue** purpose `partner_transfer` → submit Flowable → user approver duyệt → **confirm** (trừ tồn A).
3. A: tạo **Partner transfer** gắn issue đã confirm, chọn **Đối tác nhận = B** → confirm (ghi outbox, không trừ tồn lần 2).
4. Worker A gửi thông báo; B inbox ACK.
5. B: `/trading/inbound` (nguồn Nexora) / receiving — map lô local, nhập **actual** → confirm (+tồn B).
6. A: delivery_state / phiếu nhận nghiệp vụ cập nhật; theo dõi trên `/partners` nếu lỗi.

### S7 — Chiều ngược

Lặp S5–S6 với B xuất, A nhận. Cùng một Partner, vai trò supplier/customer đảo theo chiều.

### S8 — Sự cố gửi nhận

Trên `/partners` (admin): hàng đợi gửi, dead letter → Gửi lại; mapping gap → Xử lý lại. Chi tiết: [`runbook-p09-federation.md`](../../documents/phase-plan/runbook-p09-federation.md).

## 4. Script tự động liên quan

| Script | Dùng khi |
| --- | --- |
| `deploy/scripts/seed-abc.mjs a\|b` | Fixture demo zero-stock + partner stub (`DEMO_ONLY=true`) |
| `deploy/scripts/configure-abc-federation.mjs` | Upsert connection A↔B (và B↔C nếu có C) |
| `deploy/scripts/smoke-abc-federation.mjs` | Smoke M2M envelope (chạy trong worker) |
| `deploy/scripts/journey-ab-goods.mjs` | Journey hàng hoá **chỉ A↔B** (issue/transfer/receive ± chiều ngược) |
| `deploy/scripts/journey-p09-core.mjs` | Journey nghiệp vụ đầy đủ (thường A→B→C) |
| `deploy/scripts/smoke-orders-checkout.mjs a\|b` | Smoke đơn hàng theo instance |
| `deploy/scripts/abc-reset.mjs b` | Xóa volume demo B rồi dựng lại |

## 5. Tiêu chí PASS (tóm tắt)

- [ ] A và B mở ERP trên **hai cổng khác nhau**, org/instance ID khác nhau.
- [ ] Catalog / đơn hàng / tồn nội bộ **không** lẫn giữa A và B.
- [ ] Sau S4, hai bên thấy liên kết đối tác active.
- [ ] Sau S5–S6: tồn A giảm đúng qty xuất; tồn B tăng đúng actual; không double-count movement trên transfer.
- [ ] S7 đảo chiều vẫn đúng.
- [ ] S9: A sống khi B tắt; transfer không “biến mất” im lặng (retry / dead-letter có thể quan sát).

## 6. Ghi chú vận hành máy local

- RAM: 2 stack song song thường cần ≥ 8–12 GiB free; nếu thiếu, chạy lần lượt hoặc chỉ `erp`+`gateway`+`postgres`+`keycloak`+`worker`.
- Đổi code: `up -d --build` từng project; rebuild `db-migrate` sau migration Prisma mới.
- Không log / commit `*.env`, client secret, mật khẩu tạm.

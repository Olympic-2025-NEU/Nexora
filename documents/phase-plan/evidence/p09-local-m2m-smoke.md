# P09 — Kiểm chứng local federation M2M A↔B↔C

Ngày kiểm chứng: 2026-11-25. Ba Compose project `nexora-a`, `nexora-b`,
`nexora-c` chạy với PostgreSQL, Keycloak realm, ERP, worker và gateway riêng.
Chỉ gateway/worker tham gia Docker network `nexora-federation`.

- Tạo CA/certificate mkcert local với SAN cho ba gateway DNS alias. Root CA được
  mount read-only cho worker; private key và env secrets bị Git ignore.
- Tạo bốn client credentials chiều A→B, B→A, B→C, C→B trong Keycloak **nhận**.
  Token lấy qua gateway HTTPS của bên nhận. Kiểm claim `iss`, `azp`, audience
  `erp-browser` và scope `federation:write` mà không in token hoặc secret.
- Seed ba DB với identity/partner riêng, cấu hình bốn active partner connection.
  Connection chỉ chứa `env:` secret reference.
- Áp ba migration Phase 9 mới (`federation_delivery_attempt`,
  `federation_inbox`, `federation_identity_mapping`) cho từng DB. Image migrator
  local còn snapshot migration cũ do build đồng thời bị ngắt; áp bằng Prisma CLI
  trên host với từng `MIGRATOR_DATABASE_URL` trỏ vào cổng admin localhost.
  Khi rebuild image từ source hiện tại, migrator phải chứa đủ 29 migration.
- Chạy `deploy/scripts/smoke-abc-federation.mjs` bên trong worker gửi của cả
  bốn chiều. Cả bốn token request trả 200; event POST qua HTTPS trả 202 với
  `pending_dependency`; replay nguyên payload trả đúng `ackId` cũ.
- Sau bốn chiều, inbox/ACK của A là 1/1, B là 2/2, C là 1/1; stock movement
  ở cả ba DB đều bằng 0.

Runbook tái lập và các lệnh smoke test: `deploy/abc-topology.md`. Đây là kiểm
chứng trust, HTTPS, inbox và ACK với sự kiện giả lập. Chưa chứng minh transfer
nghiệp vụ và lot mapping/receiving toàn hành trình G09; các bước đó thuộc các
task Phase 9 tiếp theo.

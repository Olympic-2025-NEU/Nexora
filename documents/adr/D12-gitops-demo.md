# D12 — GitOps minh chứng trên môi trường test

- Ngày: 2026-11-16. Trạng thái: **chấp nhận hướng triển khai, spike tài nguyên/runtime hoãn P12**; reviewer thứ hai G00.
- Quyết định: Docker Compose vẫn là runtime dev và demo ba instance A/B/C. Một môi trường test nhỏ `k3s + Argo CD` triển khai một bản Nexora/core từ image **digest cố định**, manifest `deploy/gitops/` trong Git, secret chỉ bằng reference. Test drift một config/replica không chứa dữ liệu rồi quan sát Argo CD phát hiện và đồng bộ về Git; rollback bằng commit revert. Không gọi Compose/CI đơn thuần là GitOps.
- Câu hỏi: làm sao chứng minh desired-state controller thực mà không ép ba stack demo chuyển sang Kubernetes ngay P01?

Máy kiểm thử hiện có Docker Engine 29.6.1, Linux engine báo ~12.4 GB memory và 16 CPU; **đó không phải phép đo RAM đủ cho full stack + Argo CD**. P12 phải đo idle/peak RAM/CPU/disk, pin k3s/Argo CD/image versions/license, network/namespace và ghi sync event/screenshot/log. Nếu không có tài nguyên, không giả đạt G12: ghi blocker, tìm VM/test host do nhóm cấp hoặc xác nhận mức minh chứng thay thế từ BTC. Chỉ tạo drift an toàn trong namespace test, không thay dữ liệu A/B/C; restore/rollback vẫn phải diễn tập.

### Đo P12-T01 (2026-11-27) — quyết định tạm

Host demo (Windows + Docker Desktop): **15.87 GiB** RAM, **~2.17 GiB free** khi Compose instance A đang chạy; container idle Σ ≈ **2508 MiB** (Keycloak+ClamAV chiếm phần lớn). Disk C còn ~220 GiB (đủ).

**Quyết định:** không triển khai k3s+Argo CD **cùng máy** với Compose A. P12-T06 mặc định là **gap có chủ** cho tới khi có VM riêng ≥16 GiB free hoặc BTC chấp nhận mức minh chứng thay thế. Chi tiết: [`D11-dxos-proof.md`](./D11-dxos-proof.md), [`0011-four-principles-proof.md`](./0011-four-principles-proof.md).

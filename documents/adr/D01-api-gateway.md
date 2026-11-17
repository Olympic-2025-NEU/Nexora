# D01 — API Gateway và chế độ cấu hình

- Ngày: 2026-11-17. Trạng thái: **chọn Apache APISIX cho P01/P02** dựa trên spike; release gate và reviewer G00 còn mở.
- Câu hỏi: gateway nguồn mở nào tách route public/user/M2M, kiểm OIDC và cấu hình tái lập mà phù hợp tài nguyên demo?
- Quyết định: `apache/apisix:3.20.0-debian@sha256:013de62a9dfba7d8e6006b3e85b524c28c9f1c3549fca3b91d5b258b0b9e759a` ở **standalone file-driven data plane**. Route/policy là YAML versioned; không cần etcd cho v1. Không public Admin API. Tầng app/core vẫn tự kiểm token/claims/quyền tài nguyên, gateway không thay business authz. [APISIX file mode](https://apisix.apache.org/docs/apisix/installation-guide/) và [OIDC plugin](https://apisix.apache.org/docs/apisix/plugins/openid-connect/) là nguồn chính thức; source [Apache-2.0](https://github.com/apache/apisix/blob/3.20.0/LICENSE).

## Phương án và tiêu chí

| Phương án | Kết luận |
| --- | --- |
| APISIX standalone YAML | **Chọn**: OIDC plugin, `required_scopes`, JWKS, route tách và file Git; không vận hành etcd trong MVP. File cần render secret ngoài Git và restart/reload có kiểm soát. |
| APISIX traditional + etcd | Có lợi cho cập nhật động nhiều node, nhưng thêm runtime/backup/credential và RAM; chỉ đổi bằng ADR nếu vận hành sau cần. |
| Reverse proxy chỉ định tuyến URL | Không đủ để chứng minh policy OIDC M2M/user trong lõi. |

## Spike lặp lại được

[Compose và smoke](../phase-plan/evidence/spikes/infra/README.md) chạy ngày 17/11/2026. Public anonymous 200; private anonymous 401, browser user token có `erp:user` 200, hai service token 403; federation sender có `federation:write` 202, sender thiếu scope và user token 403; route lạ 404. Browser auth-code+PKCE qua Keycloak đúng 200, verifier sai 400. APISIX container RAM **358.3 MiB snapshot** sau khởi động trên Docker Engine 29.6.1; không phải peak hay số cho ba instance. Upstream trong spike là server giả 200/202, **không phải Core Data API**.

Một lỗi đã được phát hiện: private route ban đầu chỉ kiểm chữ ký nên service token vào được. Thêm `required_scopes: [erp:user]` và chạy lại cho kết quả 403. Core route trong spike cần `access_token_in_authorization_header: true` vì [APISIX OIDC](https://apisix.apache.org/docs/apisix/plugins/openid-connect/) mặc định dùng `X-Access-Token`; core tự verify JWT sau gateway. Scope một mình chưa đủ: P02 phải pin client scope grants, kiểm `iss/aud/exp`, backend kiểm membership/role/resource, chặn spoof header và bypass trực tiếp. Token phát với issuer loopback khác discovery nội bộ bị 401; production cần **một URL issuer HTTPS có thể truy cập từ browser và gateway**, không dùng Host-header workaround của spike. P02 còn phải kiểm TLS, admin plane, route method/body/rate limit, token hết hạn, sai audience và direct-app isolation. Không đánh AC-01 hay §3 đạt từ spike này.

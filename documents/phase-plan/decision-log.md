# Decision log và spike bắt buộc

Ngày rà 17/11/2026: bảng dưới giữ **tiêu chí chọn ban đầu**; trạng thái thực tế nằm ở ADR và bảng sau. Chọn một công nghệ qua spike **không** có nghĩa app/core đã triển khai hoặc gate phase đạt. Mỗi ADR ghi câu hỏi, phương án, bằng chứng, ảnh hưởng contract/license/tài nguyên và việc chưa chứng minh. Người review thứ hai ghi ở G00; không mở task phụ thuộc khi rủi ro chặn của ADR còn mở.

| ADR | Trạng thái P00-T03 | Bằng chứng hoặc gate còn mở |
| --- | --- | --- |
| [D01 Gateway](../adr/D01-api-gateway.md) | APISIX standalone YAML **đã chọn**, route OIDC spike pass | P02 TLS/issuer/audience/bypass/admin plane/app authz |
| [D02 Storage](../adr/D02-object-storage.md) | SeaweedFS 4.53 **đã chọn**, private S3 và source build pass | P03 scan, policy, metadata và full volume+DB restore |
| [D03 Database](../adr/D03-database-transaction-migrations.md) | `pg` + SQL/PoolClient **đã chọn**, rollback/migration/concurrency pass | P01/P03/P07 schema, role grants, command thật |
| [D04 Identity/session](../adr/D04-identity-session.md) | Keycloak + PKCE và server-side BFF pattern **đã chọn**; PKCE pass | P02 HTTPS issuer, session/refresh/revoke, auth library |
| [D05 Federation trust](../adr/D05-federation-trust.md) | Receiver-issued service account **đã chọn**; scope gateway pass | P02/P05/P09 client→partner mapping, A/B/C, rotate/revoke |
| [D06 Workflow](../adr/D06-workflow-engine.md) | Flowable 8 + PG17 **đã chọn**; BPMN/restart/history pass | P04/P07 app bridge/reconciler/rights/error |
| [D07 Quantity/lot](../adr/D07-quantity-unit-lot.md) | `numeric(20,3)`/unit/origin lot **đã chốt thiết kế**, PG rounding/unique probe | P06/P07 validation/schema thật |
| [D08 Envelope](../adr/D08-federation-envelope.md) | Envelope/ACK v1 **đã chốt thiết kế** | P00-T05 JSON Schema/Node-Python vectors; P09 E2E |
| [D09 AI](../adr/D09-ai-provider-boundary.md) | Ranh giới AI **đã chốt**, model/provider hoãn P10 | License/data policy/model tests P10 |
| [D10 DX-Lab](../adr/D10-dx-lab-hpdi.md) | Một app H-P-D-I tách runtime **đã chốt thiết kế** | P11 app/UI chạy thật |
| [D11 DX-OS](../adr/D11-dxos-principles-evidence.md) | Bốn bài chứng minh **đã chốt thiết kế** | Xác nhận diễn giải BTC; runtime P12 |
| [D12 GitOps](../adr/D12-gitops-demo.md) | k3s/Argo CD cho môi trường test **đã chọn có điều kiện** | P12 đo tài nguyên và drift/reconcile |
| [D13 Version/license](../adr/D13-versions-licenses-resources.md) | Image digest/top-level license/RAM snapshot **đã ghi** | P00-T04 SBOM/asset/notice; P01/P09 full peak |
| [D14 Movement](../adr/D14-stock-movement-ownership.md) | Chủ sở hữu movement **đã chốt thiết kế** | P07/P09 app tests chống double effect |
| [D15 Headless](../adr/D15-headless-core-boundary.md) | Ranh giới ba runtime **đã chốt**, spike headless+PG/auth/restart/tắt upstream pass | **Core Data/File API sản phẩm chưa có**, P01/P03 smoke khi tắt ERP/DX-Lab thật |

Smoke thành phần và lệnh tái lập: [infra](./evidence/spikes/infra/README.md), [PostgreSQL](./evidence/spikes/d03/README.md). **G00 vẫn mở**: cần reviewer thứ hai, P00-T04/T05/T06 và bằng chứng Core Data/File API sản phẩm cùng app contract; không đánh dấu Phase 00 hoàn tất.

| ID | Chốt trước | Đề xuất/điều kiện chấp nhận |
| --- | --- | --- |
| D01 Gateway | P01/P02 | Thử Apache APISIX vì có plugin OIDC/Keycloak và Compose; kiểm tra route private/public/M2M, nguồn mở, tag, phụ thuộc etcd và RAM. Nếu không đạt, chọn gateway nguồn mở khác có cùng test, không thay bằng reverse proxy chỉ route URL. |
| D02 Object storage | P01/P03 | Chọn server S3-compatible tự host có image/source tái lập, ký URL và backup. SeaweedFS là ứng viên; nếu dùng MinIO Community cần xác minh cách build/phân phối hiện hành, không mặc định có image community mới. |
| D03 Database adapter/migration | P00/P03 | Chọn **một** cách truy cập PG (ví dụ `pg` + SQL có type, hoặc Drizzle) có transaction client được truyền qua port; migration versioned. Spike confirm + stock + outbox rollback. Không dùng mỗi context một transaction độc lập. |
| D04 Identity/session | P02 | Keycloak OIDC, authorization-code + PKCE cho người dùng; backend kiểm token/claims và quyền theo DB, gateway bảo vệ route. Quyết định session/BFF theo Next.js 16 docs trong `node_modules` khi bắt đầu code. |
| D05 Federation trust | P02/P05 | Receiver cấp confidential client/service account cho partner trong realm của receiver, token client-credentials ngắn hạn; partner mapping cố định theo `client_id`/scope, không tin org ID từ body. Chứng minh A/B/C độc lập. |
| D06 Workflow process | P04/P07 | Baseline Flowable OSS REST/BPMN `goods-issue-approval` cho **mọi** GoodsIssue v1, Approver khác creator, poller/reconciler state về app. Spike chốt process key/version, timeout, retry và REST/history trên phiên bản pin; không dùng H2/mật khẩu demo trong release. |
| D07 Decimal/unit/lot | P00/P06 | Chốt đơn vị cơ sở, precision `numeric`, quy tắc hàng rời/hàng chiếc, uniqueness lot theo issuer và product. Không dùng JS float cho tồn; test làm tròn và concurrent issue. |
| D08 Trace/federation contract | P00/P08 | Event envelope có version, issuer, event/message IDs, occurred/published times, **origin lot và sender-local lot tách biệt**, upstream references, source document/evidence và sharing policy. Quyết định quyền chuyển tiếp upstream summary tới C và downstream impact summary ngược tới A; không suy diễn lô cùng tên là cùng nguồn. |
| D09 AI provider | P10 | Python service + LLM có thể tự host hoặc external theo cấu hình. Không gửi secret/PII sang external mặc định; AI chỉ gọi tool allowlist qua API có authz, không tự confirm. Chốt model, data policy, timeout, quota và fallback. |
| D10 H-P-D-I proof | P00/P11 | Chọn workspace tầng 2 cụ thể: H danh tính/hộp việc, P phê duyệt + giao nhận, D timeline/điều hành lô, I AI tra cứu/Draft. Chỉ gọi là minh họa khi UI chạy qua lõi thật. |
| D11 Bốn nguyên lý §4 | P00/P12 | Chốt minh chứng có thể demo cho lifecycle dữ liệu, IT/OT, lineage/quality, zero-trust/GitOps. Xác minh với BTC mức bắt buộc nếu có diễn giải khác; giữ phương án kỹ thuật trong Phase 12. |
| D12 GitOps demo | P12 | Compose + CI là IaC/CI, không tự động là GitOps. Nếu cần minh chứng GitOps đúng nghĩa, dùng môi trường k3s/Argo CD riêng với desired state trong Git và drift/reconcile test; không đổi toàn bộ dev stack khi chưa có tài nguyên. |
| D13 Phiên bản/giấy phép | P01/P13 | Pin image digest, lockfile, SBOM/license inventory; xác minh giấy phép của Flowable OSS, gateway, storage, model/SDK; không dùng sản phẩm enterprise không thể build từ source. |
| D14 Movement ownership | P00/P07 | Chốt chính xác chứng từ nào đổi tồn. Đề xuất: GoodsReceipt +, GoodsIssue −, ReceivingConfirmation + theo actual, Stocktake theo variance; PartnerTransfer và SaleRecord chỉ tham chiếu GoodsIssue, không trừ thêm. Một outbound issue ↔ một transfer cùng lot/qty trong MVP. Test chống double movement. |
| D15 Ranh giới headless/tầng 2 | P00/P01 | Bắt buộc chứng minh lõi không cấp UI: tách runtime core data/file API không UI khỏi Next ERP và một DX-Lab app tầng 2 riêng (có thể cùng monorepo). Core API phục vụ structured metadata/projection + file qua gateway; ERP vẫn sở hữu transaction stock/document/audit/outbox trong một app DB. Smoke core khi tắt cả hai UI. ADR chốt contract/runtime/resource. |

### Ghi chú về lựa chọn công nghệ

- [APISIX OIDC plugin](https://apisix.apache.org/docs/apisix/plugins/openid-connect/) hỗ trợ Keycloak; [hướng dẫn cài](https://apisix.apache.org/docs/apisix/installation-guide/) nêu chế độ Compose/etcd. Đây là lý do chọn **ứng viên**, không phải kết quả spike.
- [Flowable OSS REST](https://www.flowable.com/open-source/docs/bpmn/ch14-REST) có API engine; cấu hình mặc định có thể dùng H2, nên plan buộc DB bền vững và auth riêng.
- [SeaweedFS](https://github.com/seaweedfs/seaweedfs) có S3 API và giấy phép Apache-2.0; [MinIO Community](https://github.com/minio/minio) hiện mô tả phân phối community dưới dạng source-only. Kiểm lại trạng thái tại thời điểm chọn sản phẩm.
- [Argo CD](https://argo-cd.readthedocs.io/en/stable/) là controller GitOps đối chiếu trạng thái thực với Git; chỉ dùng nhãn “GitOps” khi có bằng chứng reconcile tương ứng.

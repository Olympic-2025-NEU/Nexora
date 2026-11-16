# Decision log và spike bắt buộc

Quyết định ở đây là **Accepted-provisional** theo ADR trong [`documents/adr/`](../adr/README.md) — đủ để AI/dev không tự chọn stack khác, **chưa** đủ đóng G00. Mỗi ADR cần spike lặp lại được, pin version/digest/license/RAM, rồi promote status → Accepted. Không bắt đầu task runtime phụ thuộc khi spike của ADR chặn phase đó còn pending (trừ công việc thuần tài liệu).

| ID | Chốt trước | Status | ADR | Đề xuất/điều kiện chấp nhận |
| --- | --- | --- | --- | --- |
| D01 Gateway | P01/P02 | Accepted-provisional (spike pending) | [0001](../adr/0001-gateway-apisix.md) | Apache APISIX + OIDC/Keycloak; route private/public/M2M; không thay bằng reverse proxy chỉ rewrite URL. |
| D02 Object storage | P01/P03 | Accepted-provisional (spike pending) | [0002](../adr/0002-object-storage-seaweedfs.md) | SeaweedFS S3 tự host (ứng viên); buckets quarantine/private/public; kiểm MinIO Community nếu đổi. |
| D03 Database adapter/migration | P00/P03 | Accepted-provisional (spike pending) | [0003](../adr/0003-database-prisma.md) | **Prisma Client + Prisma Migrate**; `$transaction` + `TransactionClient`; cấm Drizzle/`pg` Pool song song; xem `prisma-migration-spec.md`. |
| D04 Identity/session | P02 | Accepted-provisional (spike pending) | [0004](../adr/0004-identity-session-keycloak.md) | Keycloak OIDC + PKCE; RBAC trong app DB; CSRF/session theo Next 16 + `security.md`. |
| D05 Federation trust | P02/P05 | Accepted-provisional (spike pending) | [0005](../adr/0005-federation-trust-m2m.md) | Receiver cấp M2M client; map `client_id`→partner; không tin org ID từ body. |
| D06 Workflow process | P04/P07 | Accepted-provisional (spike pending) | [0006](../adr/0006-workflow-flowable-goods-issue.md) | Flowable OSS + PG; BPMN `goods-issue-approval` mọi GoodsIssue v1; Approver ≠ creator. |
| D07 Decimal/unit/lot | P00/P06 | Accepted-provisional (spike pending) | [0007](../adr/0007-decimal-unit-lot.md) | `numeric(20,3)`, decimal string JSON; EA/KG/L; không JS float; lot issuer-qualified. |
| D08 Trace/federation contract | P00/P08 | Accepted-provisional (spike pending) | [0008](../adr/0008-trace-federation-envelope.md) | Envelope 1.0; originLot ≠ senderBatch; ACK ≠ receiving; sharing policy. |
| D09 AI provider | P10 | Accepted-provisional (deferred P10) | [0009](../adr/0009-ai-provider.md) | Python + tool allowlist; Draft-only; chốt model/policy tại P10. |
| D10 H-P-D-I proof | P00/P11 | Accepted-provisional (spike pending) | [0010](../adr/0010-hpdi-dx-lab.md) | `apps/dx-lab` H/P/D/I qua gateway; không slide-only. |
| D11 Bốn nguyên lý §4 | P00/P12 | Accepted-provisional (spike pending) | [0011](../adr/0011-four-principles-proof.md) | Minh chứng lifecycle/IT-OT/lineage/zero-trust; xác minh BTC. |
| D12 GitOps demo | P12 | Accepted-provisional (spike pending) | [0012](../adr/0012-gitops-demo.md) | Compose+CI ≠ GitOps; k3s/Argo riêng nếu cần. |
| D13 Phiên bản/giấy phép | P01/P13 | Accepted-provisional (spike pending) | [0013](../adr/0013-versions-licenses.md) | Pin digest, SBOM, license inventory; không `latest` release. |
| D14 Movement ownership | P00/P07 | Accepted-provisional (spike pending) | [0014](../adr/0014-movement-ownership.md) | Receipt+/Issue−/Receiving+actual/Stocktake±; transfer/sale không trừ lần hai. |
| D15 Ranh giới headless/tầng 2 | P00/P01 | Accepted-provisional (spike pending) | [0015](../adr/0015-headless-tier2-boundary.md) | Core data/file headless; ERP TX; DX-Lab tách; smoke tắt UI. |

### Ghi chú về lựa chọn công nghệ

- [APISIX OIDC plugin](https://apisix.apache.org/docs/apisix/plugins/openid-connect/) hỗ trợ Keycloak; [hướng dẫn cài](https://apisix.apache.org/docs/apisix/installation-guide/) nêu chế độ Compose/etcd. Đây là lý do chọn **ứng viên**, không phải kết quả spike.
- [Flowable OSS REST](https://www.flowable.com/open-source/docs/bpmn/ch14-REST) có API engine; cấu hình mặc định có thể dùng H2, nên plan buộc DB bền vững và auth riêng.
- [SeaweedFS](https://github.com/seaweedfs/seaweedfs) có S3 API và giấy phép Apache-2.0; [MinIO Community](https://github.com/minio/minio) hiện mô tả phân phối community dưới dạng source-only. Kiểm lại trạng thái tại thời điểm chọn sản phẩm.
- [Argo CD](https://argo-cd.readthedocs.io/en/stable/) là controller GitOps đối chiếu trạng thái thực với Git; chỉ dùng nhãn “GitOps” khi có bằng chứng reconcile tương ứng.

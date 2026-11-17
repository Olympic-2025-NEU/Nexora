# Decision log và spike bắt buộc

Ngày reconcile 2026-11-17: merge `phase-00/baseline-t03` vào `develop` sau khi **chốt D03 = Prisma**. Bảng trạng thái P00-T03 lấy evidence spike từ phase-00; **D03 không còn `pg`+PoolClient**. Canonical ADR numbered: [`documents/adr/0001-…`](../adr/README.md). File `D0x-*.md` từ phase-00 giữ làm evidence chi tiết (trừ D03 superseded).

Chọn công nghệ qua spike **không** nghĩa app/core đã triển khai. Reviewer thứ hai ghi ở G00. Không mở task runtime khi rủi ro chặn của ADR còn mở (trừ tài liệu).

## Trạng thái P00-T03 (sau reconcile)

| ADR | Trạng thái | Bằng chứng / gate còn mở |
| --- | --- | --- |
| [D01](../adr/D01-api-gateway.md) → [0001](../adr/0001-gateway-apisix.md) | APISIX standalone YAML **đã chọn**; OIDC spike pass | P02 TLS/issuer/audience/bypass/admin/app authz |
| [D02](../adr/D02-object-storage.md) → [0002](../adr/0002-object-storage-seaweedfs.md) | SeaweedFS 4.53 **đã chọn**; S3 + source build pass | P03 scan/policy/metadata/full restore |
| **D03** → [0003](../adr/0003-database-prisma.md) | **Prisma Client + Migrate — CHỐT 2026-11-17** | Evidence [`spike-d03.md`](./evidence/spike-d03.md). ADR [`D03-database-transaction-migrations.md`](../adr/D03-database-transaction-migrations.md) (`pg`) **Superseded**. Spike `pg` giữ tham chiếu semantics. |
| [D04](../adr/D04-identity-session.md) → [0004](../adr/0004-identity-session-keycloak.md) | Keycloak + PKCE / BFF **đã chọn**; PKCE pass | P02 HTTPS issuer, session/refresh/revoke |
| [D05](../adr/D05-federation-trust.md) → [0005](../adr/0005-federation-trust-m2m.md) | Receiver service account **đã chọn**; scope gateway pass | P02/P05/P09 partner mapping A/B/C |
| [D06](../adr/D06-workflow-engine.md) → [0006](../adr/0006-workflow-flowable-goods-issue.md) | Flowable 8 + PG **đã chọn**; BPMN/restart pass | P04/P07 app bridge/reconciler |
| [D07](../adr/D07-quantity-unit-lot.md) → [0007](../adr/0007-decimal-unit-lot.md) | `numeric(20,3)`/unit/lot **đã chốt thiết kế** | P06/P07 schema thật |
| [D08](../adr/D08-federation-envelope.md) → [0008](../adr/0008-trace-federation-envelope.md) | Envelope/ACK v1 **đã chốt thiết kế** | P00-T05 schema vectors; P09 E2E |
| [D09](../adr/D09-ai-provider-boundary.md) → [0009](../adr/0009-ai-provider.md) | Ranh giới AI **đã chốt**; model hoãn P10 | P10 license/policy |
| [D10](../adr/D10-dx-lab-hpdi.md) → [0010](../adr/0010-hpdi-dx-lab.md) | DX-Lab H-P-D-I **đã chốt thiết kế** | P11 UI thật |
| [D11](../adr/D11-dxos-principles-evidence.md) → [0011](../adr/0011-four-principles-proof.md) | Bốn nguyên lý **đã chốt thiết kế** | BTC + P12 |
| [D12](../adr/D12-gitops-demo.md) → [0012](../adr/0012-gitops-demo.md) | k3s/Argo **có điều kiện** | P12 drift/reconcile |
| [D13](../adr/D13-versions-licenses-resources.md) → [0013](../adr/0013-versions-licenses.md) | Digest/license/RAM snapshot **đã ghi** | P00-T04 SBOM; P01 peak |
| [D14](../adr/D14-stock-movement-ownership.md) → [0014](../adr/0014-movement-ownership.md) | Movement ownership **đã chốt thiết kế** | P07/P09 tests |
| [D15](../adr/D15-headless-core-boundary.md) → [0015](../adr/0015-headless-tier2-boundary.md) | Ba runtime **đã chốt**; headless spike pass | Core Data/File API sản phẩm chưa có |

Smoke: [infra](./evidence/spikes/infra/README.md), [pg semantics spike](./evidence/spikes/d03/README.md), [Prisma SoT spike](./evidence/spike-d03.md). **G00 vẫn mở** (T04–T07, reviewer 2).

## Bảng baseline (canonical numbered ADR)

| ID | Chốt trước | Status | ADR | Ghi chú |
| --- | --- | --- | --- | --- |
| D01 Gateway | P01/P02 | Spike pass (phase-00) | [0001](../adr/0001-gateway-apisix.md) | Evidence: `D01-api-gateway.md` + infra smoke |
| D02 Object storage | P01/P03 | Spike pass (phase-00) | [0002](../adr/0002-object-storage-seaweedfs.md) | Evidence: `D02-object-storage.md` |
| D03 Database | P00/P03 | **Accepted — CHỐT Prisma** | [0003](../adr/0003-database-prisma.md) | Không `pg` Pool app access |
| D04 Identity | P02 | Spike pass (phase-00) | [0004](../adr/0004-identity-session-keycloak.md) | Evidence: `D04-identity-session.md` |
| D05 Federation trust | P02/P05 | Spike pass (phase-00) | [0005](../adr/0005-federation-trust-m2m.md) | Evidence: `D05-federation-trust.md` |
| D06 Workflow | P04/P07 | Spike pass (phase-00) | [0006](../adr/0006-workflow-flowable-goods-issue.md) | Evidence: `D06-workflow-engine.md` |
| D07 Decimal/lot | P00/P06 | Design locked | [0007](../adr/0007-decimal-unit-lot.md) | Evidence: `D07-quantity-unit-lot.md` |
| D08 Envelope | P00/P08 | Design locked | [0008](../adr/0008-trace-federation-envelope.md) | Evidence: `D08-federation-envelope.md` |
| D09 AI | P10 | Deferred model | [0009](../adr/0009-ai-provider.md) | Evidence: `D09-ai-provider-boundary.md` |
| D10 H-P-D-I | P00/P11 | Design locked | [0010](../adr/0010-hpdi-dx-lab.md) | Evidence: `D10-dx-lab-hpdi.md` |
| D11 Principles | P00/P12 | Design locked | [0011](../adr/0011-four-principles-proof.md) | Evidence: `D11-dxos-principles-evidence.md` |
| D12 GitOps | P12 | Conditional | [0012](../adr/0012-gitops-demo.md) | Evidence: `D12-gitops-demo.md` |
| D13 Versions | P01/P13 | Snapshot recorded | [0013](../adr/0013-versions-licenses.md) | Evidence: `D13-versions-licenses-resources.md` |
| D14 Movement | P00/P07 | Design locked | [0014](../adr/0014-movement-ownership.md) | Evidence: `D14-stock-movement-ownership.md` |
| D15 Headless | P00/P01 | Spike pass (phase-00) | [0015](../adr/0015-headless-tier2-boundary.md) | Evidence: `D15-headless-core-boundary.md` |

### Ghi chú công nghệ

- [APISIX OIDC](https://apisix.apache.org/docs/apisix/plugins/openid-connect/), [Flowable REST](https://www.flowable.com/open-source/docs/bpmn/ch14-REST), [SeaweedFS](https://github.com/seaweedfs/seaweedfs), [Argo CD](https://argo-cd.readthedocs.io/en/stable/).
- Persistence SoT: Prisma — xem `prisma-migration-spec.md` và ADR `0003`.

# Nexora ADRs (P00)

- **Canonical SoT:** numbered `0001`…`0020`.
- **Evidence detail:** phase-00 `D0x-*.md` (spike write-ups). Mapping: `decision-log.md`.
- **D03:** Prisma **CHỐT** — [`0003-database-prisma.md`](./0003-database-prisma.md). [`D03-database-transaction-migrations.md`](./D03-database-transaction-migrations.md) is **Superseded**.
- G00 still required before treating P01 as unblocked.

| ID | Canonical | Evidence (phase-00) | Blocks |
| --- | --- | --- | --- |
| D01 | [0001-gateway-apisix.md](./0001-gateway-apisix.md) (**Accepted**) | [D01-api-gateway.md](./D01-api-gateway.md) | P01/P02 |
| D02 | [0002-object-storage-seaweedfs.md](./0002-object-storage-seaweedfs.md) (**Accepted**) | [D02-object-storage.md](./D02-object-storage.md) | P01/P03 |
| D03 | [0003-database-prisma.md](./0003-database-prisma.md) (**CHỐT**) | ~~pg~~ superseded | P00/P03 |
| D04 | [0004-identity-session-keycloak.md](./0004-identity-session-keycloak.md) (**Accepted**) | [D04-identity-session.md](./D04-identity-session.md) | P02 |
| D05 | [0005-federation-trust-m2m.md](./0005-federation-trust-m2m.md) (**Accepted P00 design**) | [D05-federation-trust.md](./D05-federation-trust.md) | P02/P05 |
| D06 | [0006-workflow-flowable-goods-issue.md](./0006-workflow-flowable-goods-issue.md) (**Accepted**) | [D06-workflow-engine.md](./D06-workflow-engine.md) | P04/P07 |
| D07 | [0007-decimal-unit-lot.md](./0007-decimal-unit-lot.md) (**Accepted P00 design**) | [D07-quantity-unit-lot.md](./D07-quantity-unit-lot.md) | P00/P06 |
| D08 | [0008-trace-federation-envelope.md](./0008-trace-federation-envelope.md) (**Accepted P00 design**) | [D08-federation-envelope.md](./D08-federation-envelope.md) | P00/P08 |
| D09 | [0009-ai-provider.md](./0009-ai-provider.md) | [D09-ai-provider-boundary.md](./D09-ai-provider-boundary.md) | P10 |
| D10 | [0010-hpdi-dx-lab.md](./0010-hpdi-dx-lab.md) | [D10-dx-lab-hpdi.md](./D10-dx-lab-hpdi.md) | P00/P11 |
| D11 | [0011-four-principles-proof.md](./0011-four-principles-proof.md) | [D11-dxos-principles-evidence.md](./D11-dxos-principles-evidence.md) | P00/P12 |
| D12 | [0012-gitops-demo.md](./0012-gitops-demo.md) | [D12-gitops-demo.md](./D12-gitops-demo.md) | P12 |
| D13 | [0013-versions-licenses.md](./0013-versions-licenses.md) | [D13-versions-licenses-resources.md](./D13-versions-licenses-resources.md) | P01/P13 |
| D14 | [0014-movement-ownership.md](./0014-movement-ownership.md) (**Accepted P00 design**) | [D14-stock-movement-ownership.md](./D14-stock-movement-ownership.md) | P00/P07 |
| D15 | [0015-headless-tier2-boundary.md](./0015-headless-tier2-boundary.md) (**Accepted**) | [D15-headless-core-boundary.md](./D15-headless-core-boundary.md) | P00/P01 |
| D16 | [0016-ui-surface-partitioning.md](./0016-ui-surface-partitioning.md) (**Accepted**) | Requirements: `documents/requirements/SRS-UI-surfaces.md` | ERP UI / P07–P11 routes |
| D17 | [0017-catalog-variant-uom-price.md](./0017-catalog-variant-uom-price.md) (**Accepted design**; DDL chờ duyệt pack) | BRD/SRS product-catalog; pack `evidence/p065-schema-design.md` | P065 / G06.5 / trước P07 |
| D18 | [0018-rbac-multi-job-roles.md](./0018-rbac-multi-job-roles.md) (**Accepted**) | security.md; supersedes single-role membership | Members / policy / Keycloak |
| D19 | [0019-commercial-sales-order.md](./0019-commercial-sales-order.md) (**Accepted**) | BRD/SRS sales-order; BRD-Trace FR-01/02 | Commercial Order / POS checkout / invoice QR |
| D20 | [0020-unified-inbound-local-supplier.md](./0020-unified-inbound-local-supplier.md) (**Accepted**) | BRD-partner-link; SRS-UI-surfaces inbound | Unified inbound UI + LocalSupplier ≠ Partner |

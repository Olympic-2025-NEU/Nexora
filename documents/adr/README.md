# Nexora ADRs (P00)

Status convention for this package:

- **Accepted-provisional** — decision copied from `documents/phase-plan/implementation-baseline.md` / `decision-log.md` for AI/dev alignment. **Spike evidence is pending.** Dependent implementation (P01+) must not treat provisional as fully closed G00.
- Promote to **Accepted** only after spike checklist passes and evidence is linked.
- Reject/replace via new ADR + same-PR contract updates.

| ID | File | Blocks |
| --- | --- | --- |
| D01 | [0001-gateway-apisix.md](./0001-gateway-apisix.md) | P01/P02 |
| D02 | [0002-object-storage-seaweedfs.md](./0002-object-storage-seaweedfs.md) | P01/P03 |
| D03 | [0003-database-prisma.md](./0003-database-prisma.md) (**Accepted — CHỐT**; supersedes phase-00 `pg` ADR) | P00/P03 |
| D04 | [0004-identity-session-keycloak.md](./0004-identity-session-keycloak.md) | P02 |
| D05 | [0005-federation-trust-m2m.md](./0005-federation-trust-m2m.md) | P02/P05 |
| D06 | [0006-workflow-flowable-goods-issue.md](./0006-workflow-flowable-goods-issue.md) | P04/P07 |
| D07 | [0007-decimal-unit-lot.md](./0007-decimal-unit-lot.md) | P00/P06 |
| D08 | [0008-trace-federation-envelope.md](./0008-trace-federation-envelope.md) | P00/P08 |
| D09 | [0009-ai-provider.md](./0009-ai-provider.md) | P10 |
| D10 | [0010-hpdi-dx-lab.md](./0010-hpdi-dx-lab.md) | P00/P11 |
| D11 | [0011-four-principles-proof.md](./0011-four-principles-proof.md) | P00/P12 |
| D12 | [0012-gitops-demo.md](./0012-gitops-demo.md) | P12 |
| D13 | [0013-versions-licenses.md](./0013-versions-licenses.md) | P01/P13 |
| D14 | [0014-movement-ownership.md](./0014-movement-ownership.md) | P00/P07 |
| D15 | [0015-headless-tier2-boundary.md](./0015-headless-tier2-boundary.md) | P00/P01 |

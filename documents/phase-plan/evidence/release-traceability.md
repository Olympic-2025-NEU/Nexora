# P13-T01 — Release freeze & AC/PoF traceability

Date: 2026-11-27. Branch: `phase13/p13-t01-freeze` (from `phase-13` ← `phase-12` @ `27944c5`).
Owner: Dev.

## Freeze pins (this release candidate)

| Surface | Pin |
| --- | --- |
| App semver (package) | `0.1.0` (Unreleased / contest candidate) |
| OpenAPI | `contracts/openapi/nexora-v1.yaml` |
| Prisma tip migration | `20261127160000_quality_operations` |
| Seed | `deploy/scripts/seed-abc.mjs` (+ catalog seed) |
| Flowable process key | `goods-issue-approval` (deploy/flowable/processes) |
| Local image digests (demo) | erp `sha256:fc2cf681b959…`; dx-lab `sha256:350d6c158229…`; core-data `sha256:110d9498a299…`; migrator `sha256:37a9ccf30a02…` |
| SoT branch | `phase-13` |

## Out of scope for release (do not claim)

- Full finance / CRM / POS / production ERP modules beyond MVP Ch6.
- Lakehouse, production digital twin, Compose-as-GitOps.
- Independent third-party certification of quality data.

## Known blockers (tracked, not hidden)

| Item | Severity | Repro | Release decision |
| --- | --- | --- | --- |
| GitOps controller (k3s/Argo) | High for PoF GitOps claim | Host free RAM ~1.5–2.2 GiB with Compose A | **Gap documented** (P12-T06); principle Not Done |
| G09 cross-instance formal sign-off | Medium | No G09.md closed package | Proceed with evidence links; do not claim signed |
| G10 AI formal sign-off | Medium | G10.md unsigned | Same |
| AC-13 second-person clean VM | Medium | Needs another machine/operator | Agent/host run + runbook; pending peer confirm |
| BTC submission deadline confirm | High for nộp bài | Contest docs conflict 2025 vs 2026 | Checklist placeholder — no guessed date |

## AC-01…AC-13 → evidence / tests

| AC | Primary evidence / tests | Owner |
| --- | --- | --- |
| AC-01 | `tests/e2e/abc-topology*.mjs`, Compose A/B/C env examples, P09 topology | Dev |
| AC-02 | Gateway/policy suites, system org/member APIs, G02/G05 | Dev |
| AC-03 | Catalog/inventory platform tests, G06 | Dev |
| AC-04 | Trading confirm/outbox integration, G07 | Dev |
| AC-05 | Federation outbound/inbox tests, journey-p09, G09 (open) | Dev |
| AC-06 | Receiving actual/discrepancy tests, demo-fixtures §2 | Dev |
| AC-07 | Trace backward/forward, passport, P13-T02 e2e (in progress) | Dev |
| AC-08 | QR/passport privacy tests, G08/G11 | Dev |
| AC-09 | Forward impact APIs + DX-Lab D | Dev |
| AC-10 | AI tool suites + audit | Dev |
| AC-11 | AI draft adversarial + HITL, G10 (unsigned) | Dev |
| AC-12 | Flowable goods-issue-approval + approval UI | Dev |
| AC-13 | README/deploy runbooks, backup-restore, P13-T03 | Dev / Ops |

## Contest scorecard PoF / product → evidence

| Row | Evidence pointers |
| --- | --- |
| PoF-1 | https://github.com/Olympic-2025-NEU/Nexora (public) |
| PoF-2 | `LICENSE`, `npm run check:spdx`, `NOTICE`, license inventory |
| PoF-3 | P13-T06 tag/archive (pending user-confirmed tag) |
| PoF-4 | README + deploy/README clean install |
| PoF-5 | package-lock + check:licenses; no vendored deps |
| PoF-6 | README, Issues, CHANGELOG |
| Sản phẩm-7 | ADR/D11, federation actual-vs-sent, lineage |
| Sản phẩm-8 | G00–G12 + P13-T02/G13 |
| Sản phẩm-9 | G11 DX-Lab |
| Sản phẩm-10 | P12 ops + this matrix |
| Sản phẩm-11 | P13-T07 demo runbook |

## Non-claims

This matrix is a freeze map, not a signed G13. Rows without a closed gate stay open until T02–T09 evidence lands.

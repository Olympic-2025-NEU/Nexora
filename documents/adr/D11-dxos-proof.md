# D11 — DX-OS §4 proof map (P12-T01)

- **Date:** 2026-11-27
- **Branch:** `phase12/p12-t01-dxos-proof` → merge `phase-12`
- **Status:** Accepted assumptions for MVP depth; **BTC confirmation of §4 depth still open** (owner: team lead via official channel — no letter sent by agent)
- **Depends:** design ADR [`D11-dxos-principles-evidence.md`](./D11-dxos-principles-evidence.md); pins [`0011-four-principles-proof.md`](./0011-four-principles-proof.md); GitOps [`D12-gitops-demo.md`](./D12-gitops-demo.md)
- **Gate hygiene:** G09 clean-run waived/open; G10 not signed; G11 technical package on `phase-11`. P12 claims must not paper over those gaps.

This file is the **evidence map and demo contract** for the four exam §4 principles. Table-of-seven product names in the contest PDF are **reference examples**, not mandatory Nuxt/Hasura/MinIO/ArgoCD (see `scope-v1.md`).

## Assumptions (until BTC answers otherwise)

1. One-org-per-instance Compose A/B/C is acceptable isolation instead of centralized multi-tenant SaaS.
2. IT/OT may be a **labeled simulator** with device allowlist — not production sensors.
3. Archive = versioned checksummed event export + queryable report — **not** a full lakehouse.
4. GitOps requires a desired-state **controller** (k3s + Argo CD test env per D12). Compose + CI alone **does not** pass the GitOps principle.
5. Quality issues are operational warnings; they never authorize bad events or auto-mutate stock/quality.

## Evidence map — four principles

| Principle | Owner | Tasks | Runnable now (reuse) | To build (P12) | Expected result | Failure case | Must **not** claim |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lifecycle / speed | Dev | T02, T07 lag | OLTP confirm + outbox (`smoke`, trading journeys); metrics outbox age | `workers/archive-export.ts`, `archive_manifest` core record, archive query CLI | Confirm returns without waiting for archive; archive object SHA matches manifest; report lists `sourceEventIds` + measured lag | Kill archive worker mid-run → confirm still OK; restart resumes checkpoint, no duplicate partitions | “Lakehouse”, streaming bus, real-time OLAP product |
| IT/OT convergence | Dev | T03, T04 UI D | Lot timeline / passport APIs (P08/P11) | `deploy/ot/device-registry.example.json`, simulator identity, `ot_reading` ingest | Reading linked to batch; `simulated:true`; shown next to business events with `asOf`/lag | Unknown device reject+audit; stale → `qualityState=stale` without raising lot quality; same hash idempotent; different hash 409 | Production digital twin, sensor certified metrology |
| Lineage / quality | Dev | T04 (+ T02/T03 inputs) | Trace backward/forward, passport allowlist, partner_asserted states | `0009_quality_operations.sql`, six `rule_id`s, Admin `/quality/issues` | Metric on D drills to document/event IDs; open→ack→resolve/reopen audited | Conflict rejected before `local_verified`; rebuild deterministic; partner_asserted stays asserted | Independent third-party certification |
| Zero-trust + GitOps + recovery | Dev / Ops | T05, T06, T07, T08 | Gateway default-deny, OIDC, ClamAV quarantine path, backup/restore P03, `smoke-core --assert-ui-stopped`, fault-p09 | `tests/security/` matrix; Prometheus/Grafana+SLO; DR A/B/C RPO/RTO; **GitOps only if host OK** | Wrong route 401/403; infected never published; restore balances=sum(movements); alerts on kill | Forged issuer/IDOR/SSRF blocked; secret not in logs | Compose+CI as “GitOps”; Vault/HSM product stack |

## Demo scripts checklist (wire as tasks land)

| Principle | Command / artifact (target) | Status 2026-11-27 |
| --- | --- | --- |
| Lifecycle | `node deploy/scripts/smoke.mjs a` (OLTP stack up); later archive export + query | Smoke **reuse**; archive **missing** |
| IT/OT | Simulator POST → core `ot_reading`; DX-Lab `/data/lots/{id}` shows OT beside history | **Missing** producer; D UI **reuse** |
| Lineage | Trace APIs + future quality dashboard; `GET` passport privacy | Trace/passport **reuse**; quality_issue **missing** |
| Zero-trust | `npm run test:gateway`; AI adversarial; `deploy/scripts/backup.sh` + `restore.sh`; `smoke-core.mjs a --assert-ui-stopped` | **Partial pass** (existing suites); dedicated `tests/security/` **missing** |
| GitOps | `deploy/gitops/` + drift script | **Gap có chủ** — see resource baseline below |
| Observability | ERP `/api/v1/metrics`, worker `/metrics`; later Grafana | Text metrics **reuse**; dashboards **missing** |

## Resource baseline → D12 GitOps decision (2026-11-27)

Host (Windows + Docker Desktop): **15.87 GiB** RAM total, **~2.17 GiB** free while Compose instance A is up. Disk C: **~220 GiB** free (OK).

Compose A idle `docker stats --no-stream` (MiB): Keycloak 626, ClamAV 742, Flowable 298, SeaweedFS 295, gateway 220, postgres 81, erp 72, core-data 66, dx-lab 48, worker 45, redis 13 → **Σ ≈ 2508 MiB** container usage (~2.5 GiB), not including Docker VM overhead or AI/Ollama.

**Decision:** On this demo host, **do not** co-locate k3s + Argo CD with full Compose A. P12-T06 default = **documented GitOps gap** (Compose+CI is IaC, not controller reconcile) unless the team provisions a **separate** VM ≥16 GiB free for a single-instance k3s test. G12 must not mark the GitOps principle Done without controller evidence or BTC-approved alternate.

## Next slices after T01 (locked order)

1. **T05** (security matrix on existing surfaces) **in parallel with** **T02** (archive) **or** **T03** (OT) — owner picks one of T02/T03 first if capacity is single-threaded; prefer T02 if lineage report needs archive IDs.
2. **T04** after T02/T03 have events/readings to judge.
3. **T07** observability/SLO after health/metric gaps listed in phase-12 are closed enough to alert.
4. **T08** DR drill (measure RPO/RTO) using extended backup scripts.
5. **T06** only if separate host exists; else keep gap.
6. **T09 / G12** evidence package — no over-claim.

## BTC follow-up (manual)

Ask via official channel whether: (a) simulated OT is accepted; (b) one-org-per-instance isolation is accepted; (c) archive+report satisfies “lifecycle” without a named lakehouse; (d) GitOps gap with measured host limits is acceptable. Store date/source of reply under `documents/phase-plan/evidence/` and revise this map if required.

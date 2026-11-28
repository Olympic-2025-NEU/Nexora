# D11 — Four technical principles proof

- **Status:** Accepted-provisional (P12-T01 map filled 2026-11-27; BTC depth confirmation still open)
- **Blocks:** P12 / G12
- **Date:** 2026-11-16; **Updated:** 2026-11-27
- **Decision owners:** Dev
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`
- **Proof map:** [`D11-dxos-proof.md`](./D11-dxos-proof.md)
- **Design ADR:** [`D11-dxos-principles-evidence.md`](./D11-dxos-principles-evidence.md)

## Context

Nexora must prove exam §4 principles with runnable artifacts. This ADR pins what is measured on the demo host and points to the proof map. It does **not** mean G12 is closed.

## Decision

Demo evidence for: data lifecycle/speed (OLTP + archived events), IT/OT convergence (simulated sensor tied to lot), lineage/quality (source IDs + verification states), zero-trust (+ GitOps **only** with a controller per D12). Confirm expected depth with BTC; do not over-claim.

## Pin fields (P12-T01 baseline)

| Field | Value |
| --- | --- |
| Compose stack (instance A) | Gateway + Keycloak + PG + Redis + SeaweedFS + Flowable + ClamAV + core-data + erp + worker + dx-lab (AI/Ollama **not** in this snapshot) |
| App image digests (local tags) | `nexora-dx-lab@sha256:350d6c158229394ae07cef0f6e29fccc383e86752a0a8766a31bd1967b902376`; `nexora-erp@sha256:fc2cf681b959dd84f1fd949d96cb2f6c16b2fad3bc07dd4ba3814ba067df7411`; `nexora-core-data@sha256:110d9498a299d80e88e9cfa0363671f87d788b91954a992f80c50ad80bd2b2ae` |
| Infra digests | Reuse D13 / Compose pins (e.g. `postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`; APISIX/Keycloak/Flowable/SeaweedFS/ClamAV/Redis as in `D13-versions-licenses-resources.md` and `deploy/compose.yml`) |
| License | Project `AGPL-3.0-only`; component licenses per D13 / license inventory — not re-audited in T01 |
| Source URL | https://github.com/Olympic-2025-NEU/Nexora (`phase-12` from `phase-11` @ `a28855c`) |
| RAM (measured 2026-11-27) | Host 15.87 GiB total / ~2.17 GiB free with Compose A up; container Σ ≈ **2508 MiB** idle (`docker stats --no-stream`) |
| Disk | C: ~220 GiB free; Docker images+cache large (~33 GiB images, ~34 GiB build cache) |
| Owner for spike | Dev |
| GitOps (D12) | **Gap on this host** — insufficient free RAM for k3s+Argo beside Compose A; separate VM required to attempt T06 |

## Consequences

- Implementation tasks follow [`D11-dxos-proof.md`](./D11-dxos-proof.md) and [`phase-12-operability.md`](../phase-plan/phase-12-operability.md).
- Do not mark the GitOps principle Done without controller evidence or BTC-approved alternate.
- G12 remains open until T02–T09 artifacts exist or gaps are explicitly recorded.

## Contract impact

- Core record kinds `ot_reading` / `archive_manifest` already specified in `core-record-payloads-v1.md` — producers arrive in T02/T03.
- `quality_issue` migration/API in T04 per `database-schema-v1.md` / `api-payloads-v1.md`.

## Spike evidence

- [ ] BTC confirmation of depth
- [x] Map each principle to P12 tasks (`D11-dxos-proof.md`)
- [x] Avoid slide-only evidence (map requires runnable scripts; reuse inventory listed)
- [x] Host resource baseline recorded (this file + proof map)

**Evidence links:** [`D11-dxos-proof.md`](./D11-dxos-proof.md), [`../phase-plan/evidence/p12-t01.md`](../phase-plan/evidence/p12-t01.md)

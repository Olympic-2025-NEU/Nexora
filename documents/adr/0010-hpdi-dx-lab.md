# D10 — H-P-D-I DX-Lab workspace

- **Status:** Accepted — runtime boundary verified at P11-T01; H/P/D/I UX and G11 remain open
- **Blocks:** P00/P11
- **Date:** 2026-11-16
- **Decision owners:** Dev (provisional); promote after spike
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Tier-2 app at apps/dx-lab (separate runtime from ERP): H identity/inbox, P approvals+receiving, D lot timeline/ops, I AI query/Draft. Counts as contest illustration only when UI calls real headless core via gateway.

The workspace is **one** Next.js application with four areas, not four products. It has a separate image/process and no DB, object-storage or Flowable admin credential. Its browser-facing path is `/dxlab/*`; protected business calls use `/api/v1/*` through APISIX. The ERP keeps ownership of M01–M04 transactions, including stock and approval state. The workspace may fetch a public Passport without a session; all other routes obtain the current user and organization from the server-side session and recheck access at the destination API. H/P/D/I route and service ownership are recorded in [the P11-T01 map](../phase-plan/evidence/p11-t01.md).

## Minimum journeys and demo data

| Actor | Minimum journey | Boundary to prove |
| --- | --- | --- |
| Administrator A | Sign in, inspect own workspace and organization, manage a member/partner connection, follow a batch into inventory. | M01 API checks Admin; connection secret is write-only and never rendered. |
| Staff A/B | Find product, batch and warehouse; prepare and confirm a receipt/issue/transfer; on B compare sent with actual and complete receiving. | M03 owns the transaction and stock; technical ACK is distinct from business receipt. |
| Approver B/C | Open assigned inbox, approve or reject a task created by someone else, then see `decision_pending` until the Flowable bridge reconciles. | The UI cannot call Flowable admin or bypass the server separation-of-duties check. |
| Viewer A/B/C | Read authorized inventory, backward/forward trace, provenance gaps and AI sources without mutation controls. | API row/warehouse scope still returns 403 for a forced URL. |
| Public | Scan a Passport QR and view only fields permitted by the published policy; test revoked/unknown token. | Public response and DOM contain no private file or field. |

Use the existing A/B/C seed manifest (A-origin `LOT-A-001`, issuer-qualified IDs and separate databases) for the cross-instance journey. Transactions create the A→B→C history; the seed alone does not claim stock movement. Use `LOT-DEMO-001` on A only for the AI disambiguation demo recorded in G10. The journey must use API-created records, not hardcoded screen data.

## Pin fields (fill after spike)

| Field | Value |
| --- | --- |
| image / package version | Next.js 16.4.6 on pinned Node 22 image; separate `nexora-dx-lab` build |
| digest | Local image only at P11-T01; release digest deferred to G11/P13 |
| license | Nexora source AGPL-3.0-only; dependency inventory via `check:licenses` |
| source URL | `apps/dx-lab/` in this repository |
| RAM (measured) | Pending G11 load/viewport run |
| Owner for spike | Dev |

## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- G00 remains **open** while Spike evidence is pending for gate-critical ADRs (especially D01–D08, D14, D15).

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Machine-readable stubs may live under `contracts/` as `v1-provisional`.

## Spike evidence

- [x] Skeleton app boots separately — Docker image, Compose and gateway HTTP 200 at P11-T01
- [x] Four regions mapped to real APIs — see [P11-T01 service map](../phase-plan/evidence/p11-t01.md)
- [x] No claim when only mock UI — T01 page is explicitly a runtime placeholder; feature journeys and G11 remain open

**Evidence links:** [P11-T01](../phase-plan/evidence/p11-t01.md), including live gateway and stopped-UI headless smoke. This accepts the runtime choice, not completion of Phase 11.

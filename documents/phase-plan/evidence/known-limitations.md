# Known limitations (Phase 13 release)

Date: 2026-11-27. Owners: Nexora release (P13-T05). Do **not** hide these in demo or submission claims.

| ID | Limitation | Severity | Mitigation / how to reproduce | Owner |
| --- | --- | --- | --- | --- |
| KL-01 | **GitOps Not Done** — Compose + CI are not a GitOps controller; no Argo/Flux co-located on demo host | High (principle gap) | [p12-t06.md](./p12-t06.md), [G12.md](./G12.md); do not claim GitOps Done | Ops / P12 |
| KL-02 | **G09 unsigned** — no `G09.md` formal federation cross-instance sign-off in tree | Medium | Treat federation evidence as technical suites only; gate remains open | Federation |
| KL-03 | **G10 unsigned** — AI HITL package present; formal G10 sign-off pending ([G10.md](./G10.md)) | Medium | Demo AI Draft as HITL; do not claim G10 closed | AI |
| KL-04 | **OT simulated only** — `ot_reading` / lot UI `simulated:true`; not a production digital twin | High (if misclaimed) | [p12-t03.md](./p12-t03.md); demo script must say simulated | OT |
| KL-05 | **Full 3-stack A+B+C live** may OOM on narrow demo host (~1.5–2.2 GiB free with A alone) | Medium | Prefer API journey on A + topology config asserts; sequential Compose up if needed | Demo / P13-T02 |
| KL-06 | **DR restore E2E to fresh Compose project** remains operator-run (`restore.sh`); automated asserts cover post-restore checks on live A | Medium | [p12-t08.md](./p12-t08.md) | Ops |
| KL-07 | **Load SLO** measured on health/metrics paths (gateway p95 ≈ 141 ms, n=40), not full transaction mix | Low | [p12-t07.md](./p12-t07.md); do not extrapolate to OLTP capacity | Observability |
| KL-08 | **AC-13 second-person clean VM** may be pending until another person confirms install | Medium | Agent/host install evidence in P13-T03; mark pending if no second reviewer | Release |
| KL-09 | **BTC / submission receipt** not inventable by agent — checklist owns empty confirmation fields | High (process) | P13-T08; push Git ≠ submitted | Contest |
| KL-10 | **Archive query against host `postgres:5432`** can fail when only Compose DNS applies | Low | Use in-network service hostname / documented connection string | Archive |

## Non-claims (carry forward from G12)

- Not a lakehouse / streaming OLAP product.
- Compose + CI ≠ GitOps.
- `quality_issue` does not authorize bad events or mutate stock.
- Confirm OLTP does not await archive export.
- No fake BTC confirmation, submission receipt, or “second person already ran clean install” without evidence.

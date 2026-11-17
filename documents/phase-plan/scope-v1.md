# P00-T02 — Scope statement v1

**Status:** Provisional docs — **not** contest-ready until BTC deadline confirmed and G00 closed.  
**Sources:** `../referents/ACCEPTANCE_MVP.md`, `test-matrix.md`, `contest-scorecard.md`, `demo-fixtures.md`, `../referents/OLP_2026_ALIGNMENT.md`, `../referents/SOURCE_OF_TRUTH.md`.

## 1. AC-01…AC-13 vs MVP / đề thi

| AC | In MVP? | Module | Đề thi §3–4 link | Notes |
| --- | --- | --- | --- | --- |
| AC-01 | Yes | Platform / Deploy | Multi-instance / independent DB | Three stacks A/B/C, no shared DB |
| AC-02 | Yes | M01 | Org + identity | Per-instance org/members; Keycloak realm separate |
| AC-03 | Yes | M02 | Structured data | Product, batch, warehouse, stock |
| AC-04 | Yes | M03 | Business docs | Receipt/issue with lot; Draft≠stock |
| AC-05 | Yes | M04 Federation | Inter-org API | Envelope M2M; technical ACK ≠ stock |
| AC-06 | Yes | M03 + M04 | Receiving | Actual qty + discrepancy |
| AC-07 | Yes | M04 Trace | Provenance | A→B→C across 3 DBs |
| AC-08 | Yes | M04 | Public data policy | QR + Passport allowlist |
| AC-09 | Yes | M04 | Trace forward | Related tx/partners + gaps |
| AC-10 | Yes | AI01 | Intelligence | Tool-calling read with authz |
| AC-11 | Yes | AI01 + M03 | Human-in-loop | AI Draft only; user Confirm |
| AC-12 | Yes | Platform WF + M03 | Workflow executable | Flowable BPMN goods-issue |
| AC-13 | Yes | Platform / Release | Open source rebuild | Clone → build → migrate → demo |

**Contest extras (not numbered AC but mandatory):** AGPL/public repo, headless Identity + Gateway + structured/unstructured data + Workflow, H-P-D-I tier-2 app. See `OLP_2026_ALIGNMENT.md`.

## 2. Explicitly out of MVP

Do **not** add without change request:

- Finance / accounting / invoicing / GL  
- CRM / full POS / e-commerce checkout  
- Manufacturing / BOM / MRP  
- Multi-step QC lab workflows beyond batch quality status  
- Multi-level recall orchestration  
- SaaS multi-tenant shared DB (`tenant_id` across orgs)  
- BI report builder / arbitrary export warehouse  
- Generic Workflow Builder UI  
- Second ORM alongside Prisma  

Legacy scaffolds `contexts/sales|finance|procurement|master-data` are **not** MVP modules.

## 3. Demo narrative A → B → C (from demo-fixtures)

| Step | Action | A bal | B bal | C bal |
| --- | ---: | ---: | ---: | ---: |
| 1 | A confirm GoodsReceipt 20 | 20 | 0 | 0 |
| 2 | A GoodsIssue 12 (Flowable approve) confirm | 8 | 0 | 0 |
| 3 | A PartnerTransfer 12 (no second stock move) | 8 | 0 | 0 |
| 4 | B technical ACK | 8 | 0 | 0 |
| 5 | B ReceivingConfirmation actual 10 | 8 | 10 | 0 |
| 6–7 | B issue+transfer 6; C receive 6 | 8 | 4 | 6 |
| 8 | C sale issue 2 + SaleRecord (no double move) | 8 | 4 | 4 |

**Expected known stock sum:** `8+4+4=16` (vs 20 received; −2 discrepancy A→B; −2 sold).

Assertions: Draft/pending approval no movement; technical ACK ≠ receiving; transfer/sale never double-decrement; three separate DBs.

## 4. BTC deadline

| Item | Value |
| --- | --- |
| Submission / contest date | **Blocker — chưa xác nhận với BTC** |
| Owner | Dev |
| Action | Confirm against official 2026 schedule (proposal PDF may say 2025); record reply in `evidence/` before release planning |
| Until then | Do not invent a due date in plans or scorecards |

## 5. Definition of “in scope for coding after G00”

Only tasks under phase-plan P01–P13 that implement Ch6 modules M01–M04, AI01, Platform DX-OS adapters, DX-Lab H-P-D-I, and operability/release — constrained by Accepted-provisional ADRs until spike evidence promotes them to Accepted.
